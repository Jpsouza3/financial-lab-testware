import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "..", "..");
export const RESULTS_DIR = path.join(ROOT, "mutation", "results");
export const DATA_DIR = path.join(ROOT, "data");

export type TestRow = {
    test_id: string, spec_id: string | null, service_tag: string | null, project: string,
    result: "passed" | "failed" | "skipped", flaky: boolean, duration_ms: number,
};

export type Change = {
    change_id: string, commit_kind: string, seq: number, recipe: string | null,
    changed_files: string[], changed_services: string[], files_changed_count: number, lines_changed: number,
    catalog_ids: string[], seed: number | null, status: string, tests: TestRow[],
};

type RawResult = {
    id: string, kind: string, status: string, meta?: Record<string, any>,
    tests: (TestRow & { runs: string[] })[],
};

function readDir(dir: string): RawResult[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as RawResult);
}

const toRows = (r: RawResult): TestRow[] => r.tests.map((t) => ({
    test_id: t.test_id, spec_id: t.spec_id, service_tag: t.service_tag, project: t.project,
    result: t.result, flaky: t.flaky, duration_ms: t.duration_ms,
}));

/** Mudanças válidas (a suíte rodou completa): sintéticas e reais, ordenadas por `seq`. */
export function loadChanges(includeInvalid = false): Change[] {
    const synthetic = readDir(RESULTS_DIR).filter((r) => r.kind === "synthetic").map((r): Change => ({
        change_id: r.id, commit_kind: r.meta!.commit_kind, seq: r.meta!.seq, recipe: r.meta!.recipe,
        changed_files: r.meta!.changed_files, changed_services: r.meta!.changed_services,
        files_changed_count: r.meta!.files_changed_count, lines_changed: r.meta!.lines_changed,
        catalog_ids: r.meta!.catalog_ids, seed: r.meta!.seed, status: r.status, tests: toRows(r),
    }));
    const real = readDir(path.join(RESULTS_DIR, "real"))
        .sort((a, b) => String(a.meta!.commit_date).localeCompare(String(b.meta!.commit_date)))
        .map((r, i, all): Change => ({
            change_id: r.meta!.sha, commit_kind: "real", seq: i - all.length, recipe: null,
            changed_files: r.meta!.changed_files, changed_services: r.meta!.changed_services,
            files_changed_count: r.meta!.files_changed_count, lines_changed: r.meta!.lines_changed,
            catalog_ids: [], seed: null, status: r.status, tests: toRows(r),
        }));
    const all = [...real, ...synthetic].sort((a, b) => a.seq - b.seq);
    return includeInvalid ? all : all.filter(isValid);
}

export function isValid(c: Change): boolean {
    return c.status === "ok" && c.tests.length > 0;
}

/** Taxa de flakiness por teste nas execuções da base sem mudança. */
export function loadBaseline(): { runs: number, rates: Map<string, { runs: number, failures: number, flaky: number }> } {
    const results = readDir(path.join(RESULTS_DIR, "baseline")).filter((r) => r.tests.length);
    const rates = new Map<string, { runs: number, failures: number, flaky: number }>();
    for (const r of results) {
        for (const t of r.tests) {
            const entry = rates.get(t.test_id) ?? { runs: 0, failures: 0, flaky: 0 };
            entry.runs++;
            if (t.result === "failed") entry.failures++;
            if (t.flaky || t.runs.some((x) => x === "failed")) entry.flaky++;
            rates.set(t.test_id, entry);
        }
    }
    return { runs: results.length, rates };
}

export const failingTests = (c: Change): Set<string> => new Set(c.tests.filter((t) => t.result === "failed").map((t) => t.test_id));

export function csvCell(value: unknown): string {
    const text = Array.isArray(value) ? value.join(";") : value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function writeCsv(file: string, header: string[], rows: unknown[][]): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n");
}
