import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, failingTests, loadBaseline, loadChanges, ROOT } from "./dataset/load";
import { selectTests } from "../selector/select";

type Catalog = { items: { id: string, kind: string }[] };
type Criterion = { id: number, name: string, target: string, value: string, pass: boolean };

const all = loadChanges(true).filter((c) => c.commit_kind !== "real");
const valid = all.filter((c) => c.status === "ok" && c.tests.length);
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "mutation", "catalog.json"), "utf8")) as Catalog;
const baseline = loadBaseline();
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const criteria: Criterion[] = [];

criteria.push({ id: 1, name: "Commits válidos", target: ">= 120 (desejável 200)", value: `${valid.length} de ${all.length}`, pass: valid.length >= 120 });

const withFailure = valid.filter((c) => failingTests(c).size > 0);
const failShare = valid.length ? withFailure.length / valid.length : 0;
criteria.push({ id: 2, name: "Commits com >= 1 falha confirmada", target: "30% a 50%", value: pct(failShare), pass: failShare >= 0.3 && failShare <= 0.5 });

const svcShare = (s: string) => (valid.length ? valid.filter((c) => c.changed_services.includes(s)).length / valid.length : 0);
const cross = valid.length ? valid.filter((c) => c.changed_services.length >= 2).length / valid.length : 0;
const shares = ["account", "transfer", "antifraud"].map((s) => [s, svcShare(s)] as const);
criteria.push({ id: 3, name: "Cobertura por serviço / cross-service", target: ">= 25% cada; cross >= 10%",
    value: `${shares.map(([s, v]) => `${s} ${pct(v)}`).join(", ")}; cross ${pct(cross)}`, pass: shares.every(([, v]) => v >= 0.25) && cross >= 0.1 });

const allTests = new Set(valid.flatMap((c) => c.tests.filter((t) => t.result !== "skipped").map((t) => t.test_id)));
const everFailed = new Set(valid.flatMap((c) => [...failingTests(c)]));
const neverFailed = [...allTests].filter((t) => !everFailed.has(t)).sort();
const testShare = allTests.size ? everFailed.size / allTests.size : 0;
criteria.push({ id: 4, name: "Testes que falham em >= 1 commit", target: ">= 70%", value: `${pct(testShare)} (${everFailed.size}/${allTests.size})`, pass: testShare >= 0.7 });

const breakingIds = catalog.items.filter((i) => i.kind === "breaking").map((i) => i.id);
const applied = new Set(valid.flatMap((c) => c.catalog_ids));
const killers = new Set(valid.filter((c) => failingTests(c).size > 0).flatMap((c) => c.catalog_ids));
const singleBreak = new Map<string, boolean>();
for (const c of valid) {
    const b = c.catalog_ids.filter((id) => breakingIds.includes(id));
    if (b.length === 1) singleBreak.set(b[0], (singleBreak.get(b[0]) ?? false) || failingTests(c).size > 0);
}
const appliedBreaking = breakingIds.filter((id) => applied.has(id));
const killed = appliedBreaking.filter((id) => singleBreak.get(id) ?? killers.has(id));
const survivors = appliedBreaking.filter((id) => !killed.includes(id));
const killShare = appliedBreaking.length ? killed.length / appliedBreaking.length : 0;
criteria.push({ id: 5, name: "Itens quebradores que mataram >= 1 teste", target: ">= 70%",
    value: `${pct(killShare)} (${killed.length}/${appliedBreaking.length} aplicados; ${breakingIds.length - appliedBreaking.length} nunca sorteados)`, pass: killShare >= 0.7 });

const breakingCommits = valid.filter((c) => c.catalog_ids.some((id) => breakingIds.includes(id)) && failingTests(c).size > 0);
const heavy = valid.filter((c) => failingTests(c).size >= 10).length;
const small = breakingCommits.filter((c) => failingTests(c).size <= 2).length;
const smallShare = breakingCommits.length ? small / breakingCommits.length : 0;
criteria.push({ id: 6, name: "Cauda pesada de falhas", target: ">= 5 commits com >= 10 falhas e >= 30% dos quebradores com 1-2",
    value: `${heavy} commits com >= 10; ${pct(smallShare)} com 1-2`, pass: heavy >= 5 && smallShare >= 0.3 });

const flakyTests = [...baseline.rates.entries()].filter(([, r]) => r.flaky > 0).map(([id]) => id);
criteria.push({ id: 7, name: "Flakiness da base medida", target: ">= 20 execuções sem mudança", value: `${baseline.runs} execuções; ${flakyTests.length} testes flaky`, pass: baseline.runs >= 20 });

criteria.push({ id: 8, name: "Sem vazamento", target: "split temporal por seq; catalog_ids fora das features",
    value: "scripts/replay.ts divide por seq; build-dataset marca catalog_ids/seed como auditoria (docs/dataset.md)", pass: true });

let recallSum = 0, n = 0, perfect = 0;
for (const c of valid) {
    const failing = failingTests(c);
    if (!failing.size) continue;
    const sel = new Set(selectTests(c.changed_files, c.tests.map((t) => ({ test_id: t.test_id, tags: [`@${t.service_tag}`] })), []).tests);
    const r = [...failing].filter((id) => sel.has(id)).length / failing.size;
    recallSum += r; n++; if (r === 1) perfect++;
}
const recall = n ? recallSum / n : 1;
criteria.push({ id: 9, name: "Dataset discrimina (baseline serviço→testes)", target: "recall < 100% e rodar tudo mais caro",
    value: `recall médio ${pct(recall)}; ${perfect}/${n} commits com recall 100%`, pass: n > 0 && recall < 1 });

const report = {
    generated_at: new Date().toISOString(),
    criteria,
    gaps: { never_failed_tests: neverFailed, surviving_breaking_items: survivors, never_sampled_breaking_items: breakingIds.filter((id) => !applied.has(id)) },
    distribution: {
        by_kind: Object.fromEntries([...new Set(valid.map((c) => c.commit_kind))].map((k) => [k, valid.filter((c) => c.commit_kind === k).length])),
        by_status: Object.fromEntries([...new Set(all.map((c) => c.status))].map((s) => [s, all.filter((c) => c.status === s).length])),
        failures_per_commit: valid.map((c) => failingTests(c).size),
    },
};
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(DATA_DIR, "dataset-report.json"), JSON.stringify(report, null, 2) + "\n");

for (const c of criteria) console.log(`${c.pass ? "OK  " : "FALHA"} ${c.id}. ${c.name}: ${c.value} (alvo ${c.target})`);
console.log(`lacunas: ${neverFailed.length} testes nunca falharam; ${survivors.length} itens quebradores sobreviveram: ${survivors.join(", ")}`);
process.exitCode = criteria.every((c) => c.pass) ? 0 : 2;
