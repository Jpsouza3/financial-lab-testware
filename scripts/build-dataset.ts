import path from "node:path";
import { DATA_DIR, loadBaseline, loadChanges, writeCsv } from "./dataset/load";

const changes = loadChanges();
const baseline = loadBaseline();

const seen = new Set<string>();
const rows: unknown[][] = [];
for (const c of changes) {
    for (const t of c.tests) {
        const key = `${c.change_id}|${t.test_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const base = baseline.rates.get(t.test_id);
        rows.push([
            c.change_id, c.commit_kind, c.seq, c.changed_files, c.changed_services, c.files_changed_count, c.lines_changed,
            t.test_id, t.spec_id, t.service_tag, t.result, t.flaky, t.duration_ms,
            base ? (base.flaky / base.runs).toFixed(4) : "", c.catalog_ids, c.seed,
        ]);
    }
}

writeCsv(path.join(DATA_DIR, "dataset.csv"), [
    "change_id", "commit_kind", "seq", "changed_files", "changed_services", "files_changed_count", "lines_changed",
    "test_id", "spec_id", "service_tag", "result", "flaky", "duration_ms",
    "base_flaky_rate", "catalog_ids", "seed",
], rows);

writeCsv(path.join(DATA_DIR, "changes.csv"),
    ["change_id", "commit_kind", "seq", "recipe", "changed_files", "changed_services", "files_changed_count", "lines_changed", "failed_tests", "flaky_tests", "catalog_ids", "seed"],
    changes.map((c) => [c.change_id, c.commit_kind, c.seq, c.recipe, c.changed_files, c.changed_services, c.files_changed_count, c.lines_changed,
        c.tests.filter((t) => t.result === "failed").length, c.tests.filter((t) => t.flaky).length, c.catalog_ids, c.seed]));

writeCsv(path.join(DATA_DIR, "flakiness.csv"), ["test_id", "runs", "failures", "flaky_runs", "flaky_rate"],
    [...baseline.rates.entries()].sort().map(([id, r]) => [id, r.runs, r.failures, r.flaky, (r.flaky / r.runs).toFixed(4)]));

console.log(`dataset: ${changes.length} mudanças, ${rows.length} linhas (mudança × teste); flakiness: ${baseline.runs} execuções da base`);
console.log(`arquivos: data/dataset.csv, data/changes.csv, data/flakiness.csv`);
