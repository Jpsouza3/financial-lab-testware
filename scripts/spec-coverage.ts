import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Gera docs/cobertura-specs.md: testes por spec do SUT (tag @spec:<slug>) e por serviço. */
const root = path.resolve(__dirname, "..");
const sutSpecs = path.resolve(process.env.SUT_PATH ?? path.join(root, "..", "financial-lab-account"), "specs");
const out = execSync("npx playwright test --list --reporter=json", {
    cwd: root, encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, ACCOUNT_API_URL: "http://localhost:5157", TRANSFER_API_URL: "http://localhost:5257", ANTIFRAUD_API_URL: "http://localhost:5357" },
});
type Row = { file: string, tags: string[], project: string };
const rows: Row[] = [];
const walk = (suite: any): void => {
    for (const spec of suite.specs ?? []) for (const t of spec.tests) rows.push({ file: spec.file, tags: spec.tags.map((x: string) => (x.startsWith("@") ? x : `@${x}`)), project: t.projectName });
    for (const child of suite.suites ?? []) walk(child);
};
for (const s of JSON.parse(out).suites) walk(s);

const specs = fs.existsSync(sutSpecs) ? fs.readdirSync(sutSpecs).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort() : [];
const bySpec = (slug: string) => rows.filter((r) => r.tags.includes(`@spec:${slug}`));
const lines = [
    "# Cobertura das specs",
    "",
    `Gerado por \`npx tsx scripts/spec-coverage.ts\` em ${new Date().toISOString().slice(0, 10)}. Total: **${rows.length} testes** (${rows.filter((r) => r.project === "global").length} no projeto \`global\`).`,
    "",
    "| Spec (SUT `specs/`) | Testes | Arquivos | Serviço |",
    "|---|---|---|---|",
    ...specs.map((slug) => {
        const r = bySpec(slug);
        const files = [...new Set(r.map((x) => x.file))].map((f) => `\`${f}\``).join(", ");
        const services = [...new Set(r.flatMap((x) => x.tags.filter((t) => ["@account", "@transfer", "@antifraud", "@e2e"].includes(t))))].join(", ");
        return `| \`${slug}\` | ${r.length} | ${files || "—"} | ${services} |`;
    }),
    "",
    "| Serviço | Testes |",
    "|---|---|",
    ...["@account", "@transfer", "@antifraud", "@e2e"].map((t) => `| \`${t}\` | ${rows.filter((r) => r.tags.includes(t)).length} |`),
    "",
];
const untagged = rows.filter((r) => !r.tags.some((t) => t.startsWith("@spec:")));
if (untagged.length) lines.push(`Testes sem \`@spec\`: ${untagged.length}.`, "");
fs.writeFileSync(path.join(root, "docs", "cobertura-specs.md"), lines.join("\n"));
console.log(lines.join("\n"));
