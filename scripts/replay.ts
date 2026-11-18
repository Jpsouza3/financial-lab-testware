import { parseArgs } from "node:util";
import { Change, failingTests, loadChanges } from "./dataset/load";
import { loadServiceMap, selectTests } from "../selector/select";

/**
 * Replay do seletor: para cada mudança (em ordem de `seq`), compara a seleção com "rodar tudo".
 * Split temporal: as primeiras `--train` (fração) mudanças são treino; métricas reportadas no teste.
 * O baseline não aprende nada do treino além do histórico de falhas recentes, que só olha para trás.
 */
const { values } = parseArgs({ options: { train: { type: "string", default: "0.7" }, json: { type: "boolean", default: false } } });

type Metrics = { changes: number, withFailures: number, meanRecall: number, testRecall: number, fullRecallShare: number, timeSaved: number, selectedShare: number };

function evaluate(changes: Change[], history: Change[], useHistory: boolean): Metrics {
    const map = loadServiceMap();
    let recallSum = 0, withFailures = 0, caught = 0, totalFailures = 0, full = 0, fullTime = 0, selectedTime = 0, selectedCount = 0, totalCount = 0;
    for (const change of changes) {
        const idx = history.indexOf(change);
        const previous = history.slice(Math.max(0, idx - map.recentFailuresWindow), idx);
        const recent = useHistory ? previous.flatMap((c) => [...failingTests(c)]) : [];
        const tests = change.tests.map((t) => ({ test_id: t.test_id, tags: [t.service_tag ? `@${t.service_tag}` : ""] }));
        const selection = new Set(selectTests(change.changed_files, tests, recent, map).tests);
        const failing = failingTests(change);
        const hit = [...failing].filter((id) => selection.has(id)).length;
        if (failing.size) {
            withFailures++;
            recallSum += hit / failing.size;
            if (hit === failing.size) full++;
        }
        caught += hit;
        totalFailures += failing.size;
        for (const t of change.tests) {
            fullTime += t.duration_ms;
            totalCount++;
            if (selection.has(t.test_id)) { selectedTime += t.duration_ms; selectedCount++; }
        }
    }
    return {
        changes: changes.length, withFailures,
        meanRecall: withFailures ? recallSum / withFailures : 1,
        testRecall: totalFailures ? caught / totalFailures : 1,
        fullRecallShare: withFailures ? full / withFailures : 1,
        timeSaved: fullTime ? 1 - selectedTime / fullTime : 0,
        selectedShare: totalCount ? selectedCount / totalCount : 0,
    };
}

const changes = loadChanges();
const cut = Math.floor(changes.length * Number(values.train));
const test = changes.slice(cut);
const report = {
    split: { total: changes.length, train: cut, test: test.length, testSeqFrom: test[0]?.seq, testSeqTo: test[test.length - 1]?.seq },
    runAll: { meanRecall: 1, testRecall: 1, timeSaved: 0 },
    serviceBaseline: evaluate(test, changes, false),
    serviceBaselinePlusRecentFailures: evaluate(test, changes, true),
};

if (values.json) console.log(JSON.stringify(report, null, 2));
else {
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    console.log(`Split temporal por seq: ${report.split.train} treino / ${report.split.test} teste (seq ${report.split.testSeqFrom}..${report.split.testSeqTo})`);
    console.log("seletor                         | recall médio | recall por teste | mudanças 100% | tempo economizado | testes rodados");
    console.log(`rodar tudo                      | 100.0%       | 100.0%           | 100.0%        | 0.0%              | 100.0%`);
    for (const [name, m] of [["serviço→testes", report.serviceBaseline], ["serviço→testes + falhas recentes", report.serviceBaselinePlusRecentFailures]] as const)
        console.log(`${name.padEnd(32)}| ${pct(m.meanRecall).padEnd(13)}| ${pct(m.testRecall).padEnd(17)}| ${pct(m.fullRecallShare).padEnd(14)}| ${pct(m.timeSaved).padEnd(18)}| ${pct(m.selectedShare)}`);
}
