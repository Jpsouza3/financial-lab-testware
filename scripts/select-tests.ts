import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { execSync } from "node:child_process";
import { selectTests, SelectableTest } from "../selector/select";

/**
 * Uso:
 *   git -C <sut> diff --name-only <base>...<head> | npx tsx scripts/select-tests.ts --format grep
 *   npx tsx scripts/select-tests.ts --files a.cs,b.cs --format files
 * Formatos: ids (um test_id por linha), files (arquivos de spec), grep (regex para `playwright test --grep`), json.
 * Falhas recentes: --history <dir com relatórios JSON do Playwright ou results/*.json>.
 */
const { values } = parseArgs({
    options: {
        files: { type: "string" },
        format: { type: "string", default: "ids" },
        history: { type: "string" },
        window: { type: "string", default: "5" },
    },
});

function listTests(): SelectableTest[] {
    const out = execSync("npx playwright test --list --reporter=json", { cwd: path.resolve(__dirname, ".."), encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, ACCOUNT_API_URL: process.env.ACCOUNT_API_URL ?? "http://localhost:5157", TRANSFER_API_URL: process.env.TRANSFER_API_URL ?? "http://localhost:5257", ANTIFRAUD_API_URL: process.env.ANTIFRAUD_API_URL ?? "http://localhost:5357" } });
    const tests: SelectableTest[] = [];
    const walk = (suite: any, titles: string[]): void => {
        const path_ = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
        for (const spec of suite.specs ?? []) tests.push({ test_id: `${spec.file} › ${[...path_, spec.title].join(" › ")}`, tags: spec.tags.map((t: string) => (t.startsWith("@") ? t : `@${t}`)) });
        for (const child of suite.suites ?? []) walk(child, path_);
    };
    for (const s of JSON.parse(out).suites) walk(s, []);
    return [...new Map(tests.map((t) => [t.test_id, t])).values()];
}

function recentFailures(dir: string | undefined, window: number): string[] {
    if (!dir || !fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, window);
    const failed = new Set<string>();
    for (const file of files) {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        for (const t of data.tests ?? []) if (t.result === "failed") failed.add(t.test_id);
    }
    return [...failed];
}

const changed = values.files ? values.files.split(",") : fs.readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
const tests = listTests();
const selection = selectTests(changed, tests, recentFailures(values.history, Number(values.window)));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

switch (values.format) {
    case "json":
        console.log(JSON.stringify(selection, null, 2));
        break;
    case "files":
        console.log([...new Set(selection.tests.map((id) => id.split(" › ")[0]))].join("\n"));
        break;
    case "grep": {
        if (selection.mode === "all") { console.log("."); break; }
        if (selection.mode === "none") { console.log("^$"); break; }
        const titles = selection.tests.filter((id) => !tests.find((t) => t.test_id === id)!.tags.some((tag) => selection.tags.includes(tag)))
            .map((id) => escape(id.split(" › ").slice(1).join(" ")));
        console.log([...selection.tags.map(escape), ...titles].join("|"));
        break;
    }
    default:
        console.log(selection.tests.join("\n"));
}
console.error(`select-tests: ${selection.mode} (${selection.tests.length}/${tests.length} testes) - ${selection.reason}`);
