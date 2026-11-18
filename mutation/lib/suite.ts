import fs from "node:fs";
import path from "node:path";
import { exec } from "./exec";
import { TESTWARE_DIR } from "./paths";

export type TestRun = "passed" | "failed" | "skipped";

export type TestOutcome = {
    test_id: string,
    file: string,
    line: number,
    title: string,
    project: string,
    tags: string[],
    spec_id: string | null,
    service_tag: string | null,
    result: TestRun,
    flaky: boolean,
    duration_ms: number,
    runs: TestRun[],
    error?: string,
};

export type SuiteUrls = { account: string, transfer: string, antifraud: string };

type JsonSpec = { title: string, file: string, line: number, tags: string[], tests: JsonTest[] };
type JsonTest = { projectName: string, status: string, results: { status: string, duration: number, error?: { message?: string } }[] };
type JsonSuite = { title: string, file: string, specs: JsonSpec[], suites?: JsonSuite[] };

function collect(suite: JsonSuite, titles: string[], out: TestOutcome[]): void {
    const path_ = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
        for (const test of spec.tests) {
            const last = test.results[test.results.length - 1];
            const run: TestRun = test.status === "skipped" ? "skipped" : test.status === "expected" ? "passed" : "failed";
            const title = [...path_, spec.title].join(" › ");
            const tags = spec.tags.map((t) => (t.startsWith("@") ? t : `@${t}`));
            out.push({
                test_id: `${spec.file} › ${title}`,
                file: spec.file,
                line: spec.line,
                title,
                project: test.projectName,
                tags,
                spec_id: tags.find((t) => t.startsWith("@spec:"))?.slice(6) ?? null,
                service_tag: tags.find((t) => ["@account", "@transfer", "@antifraud", "@e2e"].includes(t))?.slice(1) ?? null,
                result: run,
                flaky: false,
                duration_ms: test.results.reduce((sum, r) => sum + r.duration, 0),
                runs: [run],
                ...(run === "failed" && last?.error?.message ? { error: last.error.message.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 600) } : {}),
            });
        }
    }
    for (const child of suite.suites ?? []) collect(child, path_, out);
}

export async function runPlaywright(
    project: "api" | "global",
    urls: SuiteUrls,
    workDir: string,
    options: { locations?: string[], workers: number, timeoutMs: number, label: string, grep?: string }
): Promise<{ tests: TestOutcome[], error?: string }> {
    const report = path.join(workDir, `${options.label}.json`);
    fs.rmSync(report, { force: true });
    const args = ["playwright", "test", `--project=${project}`, "--retries=0", "--reporter=json",
        `--workers=${options.workers}`, `--output=${path.join(workDir, `pw-${options.label}`)}`, ...(options.grep ? [`--grep=${options.grep}`] : []), ...(options.locations ?? [])];
    const res = await exec("npx", args, {
        cwd: TESTWARE_DIR,
        timeoutMs: options.timeoutMs,
        env: {
            ENV: "mutation",
            CI: "",
            ACCOUNT_API_URL: urls.account,
            TRANSFER_API_URL: urls.transfer,
            ANTIFRAUD_API_URL: urls.antifraud,
            PLAYWRIGHT_JSON_OUTPUT_FILE: report,
        },
    });
    if (!fs.existsSync(report)) return { tests: [], error: `playwright sem relatório (code ${res.code}${res.timedOut ? ", timeout" : ""}): ${res.stderr.slice(-1500)}` };
    const json = JSON.parse(fs.readFileSync(report, "utf8")) as { suites: JsonSuite[], errors?: { message?: string }[] };
    const tests: TestOutcome[] = [];
    for (const suite of json.suites) collect(suite, [], tests);
    const error = res.timedOut ? "timeout da suíte" : json.errors?.length ? json.errors.map((e) => e.message).join("\n").slice(0, 1500) : undefined;
    return { tests, error };
}

/** Roda a suíte (api e depois global) e reexecuta 2x cada falha: só é falha quem falha em todas. */
export async function runSuite(urls: SuiteUrls, workDir: string, workers: number, timeoutMs: number, reruns = 2, grep?: string) {
    const errors: string[] = [];
    const all: TestOutcome[] = [];
    for (const project of ["api", "global"] as const) {
        const first = await runPlaywright(project, urls, workDir, { workers, timeoutMs, label: project, grep });
        if (first.error) errors.push(`${project}: ${first.error}`);
        all.push(...first.tests);
    }
    for (let attempt = 1; attempt <= reruns; attempt++) {
        for (const project of ["api", "global"] as const) {
            const pending = all.filter((t) => t.project === project && t.runs.every((r) => r === "failed"));
            if (!pending.length) continue;
            const rerun = await runPlaywright(project, urls, workDir, {
                workers, timeoutMs, label: `${project}-rerun${attempt}`,
                locations: [...new Set(pending.map((t) => `${t.file}:${t.line}`))],
            });
            for (const test of pending) {
                const again = rerun.tests.find((r) => r.test_id === test.test_id);
                test.runs.push(again?.result ?? "failed");
            }
        }
    }
    for (const test of all) {
        if (test.runs[0] !== "failed") continue;
        const passedLater = test.runs.some((r) => r === "passed");
        test.result = passedLater ? "passed" : "failed";
        test.flaky = passedLater;
    }
    return { tests: all, errors };
}
