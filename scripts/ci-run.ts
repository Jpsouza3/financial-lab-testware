import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { runSuite } from "../mutation/lib/suite";

/**
 * Execução da suíte no CI com o mesmo formato de resultado do dataset (results/<id>.json):
 * projeto api, depois global, e reexecução de cada falha 2x (só é falha quem falha em todas).
 */
const { values } = parseArgs({
    options: {
        id: { type: "string", default: `ci-${Date.now()}` },
        out: { type: "string", default: "ci-results" },
        grep: { type: "string" },
        workers: { type: "string", default: String(Math.max(2, os.cpus().length)) },
        "changed-files": { type: "string" },
        "sut-sha": { type: "string", default: "" },
    },
});

async function main(): Promise<void> {
    const urls = {
        account: process.env.ACCOUNT_API_URL ?? "http://localhost:5157",
        transfer: process.env.TRANSFER_API_URL ?? "http://localhost:5257",
        antifraud: process.env.ANTIFRAUD_API_URL ?? "http://localhost:5357",
    };
    const workDir = path.resolve(values.out!, ".work");
    fs.mkdirSync(workDir, { recursive: true });
    const started = Date.now();
    const grep = values.grep && values.grep !== "." ? values.grep : undefined;
    const suite = await runSuite(urls, workDir, Number(values.workers), 30 * 60_000, 2, grep);
    const tests = suite.tests;
    const summary = {
        total: tests.length,
        passed: tests.filter((t) => t.result === "passed").length,
        failed: tests.filter((t) => t.result === "failed").length,
        skipped: tests.filter((t) => t.result === "skipped").length,
        flaky: tests.filter((t) => t.flaky).length,
    };
    const result = {
        id: values.id, kind: "ci", status: suite.errors.length ? "suite_error" : "ok", reason: suite.errors.join("\n") || undefined,
        sut_sha: values["sut-sha"], grep: grep ?? null,
        changed_files: values["changed-files"] ? fs.readFileSync(values["changed-files"], "utf8").split("\n").filter(Boolean) : [],
        started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(), suite_ms: Date.now() - started,
        summary, tests,
    };
    fs.writeFileSync(path.join(values.out!, `${values.id}.json`), JSON.stringify(result, null, 2) + "\n");
    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`${values.id}: ${summary.passed} ok, ${summary.failed} falhas, ${summary.flaky} flaky, ${summary.skipped} puladas (${summary.total})`);
    process.exitCode = summary.failed || suite.errors.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
