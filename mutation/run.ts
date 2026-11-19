import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { mustExec } from "./lib/exec";
import { COMMITS_DIR, readBase, readJson, RESULTS_DIR, SUT_PATH, TESTWARE_DIR, WORK_DIR, writeJson } from "./lib/paths";
import { imagesFor, changedServices } from "./lib/services";
import { buildImage, ensureBaseImages, Images, removeImages, slotUrls, stackDown, stackUp, writeDelayOverride } from "./lib/stack";
import { runSuite, TestOutcome } from "./lib/suite";
import { withWorktree } from "./lib/worktree";
import type { CommitMeta } from "./generate";

type Job = {
    id: string,
    kind: "synthetic" | "baseline" | "real",
    sha: string,
    patch?: string,
    changedFiles: string[],
    delayMs?: number,
    meta?: Record<string, unknown>,
    out: string,
};

export type RunResult = {
    id: string, kind: Job["kind"], status: "ok" | "build_failed" | "suite_error" | "timeout",
    reason?: string, sut_sha: string, testware_sha: string, suite_tag: string,
    started_at: string, finished_at: string, build_ms: number, suite_ms: number,
    stack_healthy: boolean, af_default_delay_ms: number | null,
    rebuilt_images: string[], meta?: Record<string, unknown>,
    summary: { total: number, passed: number, failed: number, skipped: number, flaky: number },
    tests: TestOutcome[],
};

const { values } = parseArgs({
    options: {
        ids: { type: "string" },
        slots: { type: "string", default: "2" },
        workers: { type: "string", default: String(Math.max(2, Math.floor(os.cpus().length / 3))) },
        baseline: { type: "string" },
        delays: { type: "string", default: "300,800,1500" },
        real: { type: "string" },
        "timeout-min": { type: "string", default: "30" },
        limit: { type: "string" },
    },
});

const base = readBase();
const timeoutMs = Number(values["timeout-min"]) * 60_000;
const workers = Number(values.workers);
let testwareSha = "";

function pendingJobs(): Job[] {
    if (values.baseline) {
        const dir = path.join(RESULTS_DIR, "baseline");
        const delays = values.delays!.split(",").map(Number);
        return Array.from({ length: Number(values.baseline) }, (_, i) => {
            const id = `base-${String(i + 1).padStart(4, "0")}`;
            return { id, kind: "baseline" as const, sha: base.base_sha, changedFiles: [], delayMs: delays[i % delays.length], out: path.join(dir, `${id}.json`) };
        }).filter((j) => !fs.existsSync(j.out));
    }
    if (values.real) return [];
    const ids = values.ids?.split(",");
    const metas = fs.readdirSync(COMMITS_DIR).filter((f) => f.endsWith(".meta.json"))
        .map((f) => readJson<CommitMeta>(path.join(COMMITS_DIR, f)))
        .filter((m) => (ids ? ids.includes(m.id) : true))
        .sort((a, b) => a.seq - b.seq);
    return metas.map((m) => ({
        id: m.id, kind: "synthetic" as const, sha: m.base_sha,
        patch: path.join(COMMITS_DIR, `${m.id}.patch`), changedFiles: m.changed_files,
        meta: m as unknown as Record<string, unknown>,
        out: path.join(RESULTS_DIR, `${m.id}.json`),
    })).filter((j) => !fs.existsSync(j.out));
}

async function realJobs(): Promise<Job[]> {
    const jobs: Job[] = [];
    for (const ref of values.real!.split(",")) {
        const sha = (await mustExec("git", ["-C", SUT_PATH, "rev-parse", ref])).trim();
        const files = (await mustExec("git", ["-C", SUT_PATH, "show", "--name-only", "--format=", sha])).trim().split("\n").filter(Boolean)
            .filter((f) => !/(^|\/)(bin|obj|\.idea)\//.test(f));
        const numstat = (await mustExec("git", ["-C", SUT_PATH, "show", "--numstat", "--format=", sha])).trim().split("\n").filter(Boolean)
            .filter((l) => !/(^|\/)(bin|obj|\.idea)\//.test(l.split("\t")[2] ?? ""));
        const lines = numstat.reduce((s, l) => s + (Number(l.split("\t")[0]) || 0) + (Number(l.split("\t")[1]) || 0), 0);
        const date = (await mustExec("git", ["-C", SUT_PATH, "show", "-s", "--format=%cI", sha])).trim();
        const subject = (await mustExec("git", ["-C", SUT_PATH, "show", "-s", "--format=%s", sha])).trim();
        const id = `real-${sha.slice(0, 8)}`;
        jobs.push({
            id, kind: "real", sha, changedFiles: files,
            meta: { id, sha, commit_date: date, subject, commit_kind: "real", changed_files: files, changed_services: changedServices(files), files_changed_count: files.length, lines_changed: lines },
            out: path.join(RESULTS_DIR, "real", `${id}.json`),
        });
    }
    return jobs.filter((j) => !fs.existsSync(j.out));
}

let baseImages: Images | null = null;

async function runJob(job: Job, slot: number): Promise<RunResult> {
    const started = Date.now();
    const workDir = path.join(WORK_DIR, `slot-${slot}`);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    const result: RunResult = {
        id: job.id, kind: job.kind, status: "ok", sut_sha: job.sha, testware_sha: testwareSha, suite_tag: base.suite_tag,
        started_at: new Date(started).toISOString(), finished_at: "", build_ms: 0, suite_ms: 0,
        stack_healthy: true, af_default_delay_ms: job.delayMs ?? null, rebuilt_images: [], meta: job.meta,
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 }, tests: [],
    };

    await withWorktree(`run-${slot}`, job.sha, async (dir) => {
        if (job.patch) await mustExec("git", ["-C", dir, "apply", "--binary", job.patch]);
        const images: Images = job.kind === "real" ? { ...(await ensureBaseImages(dir, job.sha, timeoutMs)) } : { ...baseImages! };
        const rebuild = job.kind === "synthetic" ? imagesFor(job.changedFiles) : [];
        const buildStart = Date.now();
        for (const service of rebuild) {
            const tag = `flmut/${service}-api:${job.id}`;
            const error = await buildImage(dir, service, tag, timeoutMs);
            if (error) {
                result.status = "build_failed";
                result.reason = `${service}: ${error}`;
                return;
            }
            images[service] = tag;
            result.rebuilt_images.push(tag);
        }
        result.build_ms = Date.now() - buildStart;

        let composeDir = dir;
        if (job.kind === "real") {
            composeDir = path.join(workDir, "compose");
            fs.mkdirSync(composeDir, { recursive: true });
            fs.writeFileSync(path.join(composeDir, "docker-compose.yml"),
                await mustExec("git", ["-C", SUT_PATH, "show", `${base.base_sha}:docker-compose.yml`]));
        }
        const override = job.delayMs !== undefined ? writeDelayOverride(path.join(workDir, "delay.override.yml"), job.delayMs) : undefined;
        try {
            const upError = await stackUp(composeDir, slot, images, override);
            if (upError) { result.stack_healthy = false; result.reason = `stack sem health: ${upError}`; }
            const suiteStart = Date.now();
            const suite = await runSuite(slotUrls(slot), workDir, workers, timeoutMs);
            result.suite_ms = Date.now() - suiteStart;
            result.tests = suite.tests;
            if (suite.errors.length) {
                result.status = suite.errors.some((e) => e.includes("timeout")) ? "timeout" : "suite_error";
                result.reason = [result.reason, ...suite.errors].filter(Boolean).join("\n");
            }
        } finally {
            await stackDown(composeDir, slot, images, override);
            await removeImages(result.rebuilt_images);
        }
    });

    result.finished_at = new Date().toISOString();
    const t = result.tests;
    result.summary = {
        total: t.length,
        passed: t.filter((x) => x.result === "passed").length,
        failed: t.filter((x) => x.result === "failed").length,
        skipped: t.filter((x) => x.result === "skipped").length,
        flaky: t.filter((x) => x.flaky).length,
    };
    return result;
}

async function main(): Promise<void> {
    testwareSha = (await mustExec("git", ["-C", TESTWARE_DIR, "rev-parse", "HEAD"])).trim();
    let jobs = values.real ? await realJobs() : pendingJobs();
    if (values.limit) jobs = jobs.slice(0, Number(values.limit));
    if (!jobs.length) { console.log("nada pendente"); return; }

    if (jobs.some((j) => j.kind !== "real")) {
        await withWorktree("base-images", base.base_sha, async (dir) => {
            baseImages = await ensureBaseImages(dir, base.base_sha, timeoutMs);
        });
    }

    const slots = Math.min(Number(values.slots), jobs.length);
    console.log(`${jobs.length} execução(ões), ${slots} slot(s), ${workers} worker(s) por slot`);
    const queue = [...jobs];
    await Promise.all(Array.from({ length: slots }, async (_, slot) => {
        for (let job = queue.shift(); job; job = queue.shift()) {
            const t0 = Date.now();
            let result: RunResult;
            try {
                result = await runJob(job, slot);
            } catch (e) {
                console.error(`[slot ${slot}] ${job.id}: erro de infraestrutura, não gravado: ${(e as Error).message.slice(0, 500)}`);
                continue;
            }
            writeJson(job.out, result);
            const s = result.summary;
            console.log(`[slot ${slot}] ${job.id} ${result.status} ${s.failed} falha(s) ${s.flaky} flaky / ${s.total} em ${Math.round((Date.now() - t0) / 1000)}s`);
        }
    }));
}

main().catch((e) => { console.error(e); process.exit(1); });
