import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { applyItem, CatalogItem, CatalogKind, loadCatalog, Service } from "./lib/catalog";
import { COMMITS_DIR, MUTATION_DIR, readBase, readJson, writeJson } from "./lib/paths";
import { createRng, Rng } from "./lib/rng";
import { changedServices } from "./lib/services";
import { diffAgainst, resetTree, withWorktree } from "./lib/worktree";

type Range = [number, number];
type Recipe = {
    id: string, weight: number,
    breaking?: Range, neutral?: Range, additive?: Range, config?: Range,
    sameService?: boolean, minServices?: number,
};
type Recipes = {
    recipes: Recipe[],
    fileWeights: { pattern: string, weight: number }[],
    defaultFileWeight: number,
    serviceWeights: Record<Service, number>,
    itemWeights?: Record<string, number>,
};

export type CommitMeta = {
    id: string, seq: number, seed: number, recipe: string, commit_kind: string,
    catalog_ids: string[], changed_files: string[], changed_services: string[],
    files_changed_count: number, lines_added: number, lines_removed: number, lines_changed: number,
    base_sha: string, generated_at: string,
};

const recipes = readJson<Recipes>(path.join(MUTATION_DIR, "recipes.json"));
const catalog = loadCatalog();

function itemWeight(item: CatalogItem): number {
    const file = recipes.fileWeights.find((w) => new RegExp(w.pattern).test(item.file))?.weight ?? recipes.defaultFileWeight;
    return file * (recipes.serviceWeights[item.service] ?? 1) * (recipes.itemWeights?.[item.id] ?? 1);
}

function commitKind(ids: CatalogItem[]): string {
    const has = (k: CatalogKind) => ids.some((i) => i.kind === k);
    if (has("breaking") && (has("additive") || has("config"))) return "mixed";
    if (has("breaking")) return "breaking";
    if (has("additive")) return "additive";
    if (has("config")) return "config";
    return "neutral";
}

/** Sorteia e aplica os itens de uma receita. Itens que não aplicam (conflito) são trocados por outros. */
function compose(rng: Rng, recipe: Recipe, dir: string): CatalogItem[] {
    const chosen: CatalogItem[] = [];
    const tryAdd = (pool: CatalogItem[]): boolean => {
        const candidates = pool.filter((i) => !chosen.some((c) => c.id === i.id));
        for (let attempt = 0; attempt < 12 && candidates.length; attempt++) {
            const item = rng.weighted(candidates, itemWeight);
            candidates.splice(candidates.indexOf(item), 1);
            if (applyItem(dir, item) === null) {
                chosen.push(item);
                return true;
            }
        }
        return false;
    };
    const ofKind = (k: CatalogKind) => catalog.items.filter((i) => i.kind === k);
    const count = (r?: Range) => (r ? rng.int(r[0], r[1]) : 0);

    const breaking = count(recipe.breaking);
    for (let i = 0; i < breaking; i++) {
        let pool = ofKind("breaking");
        const services = new Set(chosen.map((c) => c.service));
        if (recipe.sameService && chosen.length) pool = pool.filter((p) => p.service === chosen[0].service);
        if (recipe.minServices && i > 0 && services.size < recipe.minServices) pool = pool.filter((p) => !services.has(p.service));
        tryAdd(pool);
    }
    for (let i = count(recipe.additive); i > 0; i--) tryAdd(ofKind("additive"));
    for (let i = count(recipe.config); i > 0; i--) tryAdd(ofKind("config"));

    const neutral = count(recipe.neutral);
    for (let i = 0; i < neutral; i++) tryAdd(ofKind("neutral"));

    if (recipe.minServices) {
        const sut = () => new Set(chosen.map((c) => c.service).filter((s) => s !== "docs"));
        for (let guard = 0; sut().size < recipe.minServices && guard < 5; guard++)
            tryAdd(ofKind("neutral").filter((n) => n.service !== "docs" && !sut().has(n.service)));
    }
    return chosen;
}

function nextSeq(): number {
    if (!fs.existsSync(COMMITS_DIR)) return 1;
    const seqs = fs.readdirSync(COMMITS_DIR)
        .filter((f) => f.endsWith(".meta.json"))
        .map((f) => readJson<CommitMeta>(path.join(COMMITS_DIR, f)).seq);
    return seqs.length ? Math.max(...seqs) + 1 : 1;
}

export async function generateOne(dir: string, baseSha: string, seq: number, seed: number, write = true): Promise<{ meta: CommitMeta, patch: string } | null> {
    await resetTree(dir, baseSha);
    const rng = createRng(seed);
    const recipe = rng.weighted(recipes.recipes, (r) => r.weight);
    const items = compose(rng, recipe, dir);
    if (!items.length) return null;
    const diff = await diffAgainst(dir, baseSha);
    const id = `syn-${String(seq).padStart(4, "0")}`;
    const meta: CommitMeta = {
        id, seq, seed, recipe: recipe.id, commit_kind: commitKind(items),
        catalog_ids: items.map((i) => i.id),
        changed_files: diff.files,
        changed_services: changedServices(diff.files),
        files_changed_count: diff.files.length,
        lines_added: diff.linesAdded, lines_removed: diff.linesRemoved,
        lines_changed: diff.linesAdded + diff.linesRemoved,
        base_sha: baseSha,
        generated_at: new Date().toISOString(),
    };
    if (write) {
        fs.writeFileSync(path.join(COMMITS_DIR, `${id}.patch`), diff.patch);
        writeJson(path.join(COMMITS_DIR, `${id}.meta.json`), meta);
    }
    return { meta, patch: diff.patch };
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            count: { type: "string", default: "20" },
            seed: { type: "string" },
            verify: { type: "string" },
        },
    });
    const base = readBase();
    fs.mkdirSync(COMMITS_DIR, { recursive: true });

    await withWorktree("generate", base.base_sha, async (dir) => {
        if (values.verify) {
            const meta = readJson<CommitMeta>(path.join(COMMITS_DIR, `${values.verify}.meta.json`));
            const original = fs.readFileSync(path.join(COMMITS_DIR, `${values.verify}.patch`), "utf8");
            const again = await generateOne(dir, meta.base_sha, meta.seq, meta.seed, false);
            const same = again?.patch === original;
            console.log(`${values.verify}: ${same ? "mesmo patch (reprodutível)" : "PATCH DIFERENTE"}`);
            process.exitCode = same ? 0 : 1;
            return;
        }
        const first = nextSeq();
        const batchSeed = values.seed ? Number(values.seed) : Date.now() % 1_000_000;
        for (let i = 0; i < Number(values.count); i++) {
            const seq = first + i;
            const generated = await generateOne(dir, base.base_sha, seq, batchSeed + i);
            if (!generated) { console.log(`seq ${seq}: nenhum item aplicável`); continue; }
            const m = generated.meta;
            console.log(`${m.id} ${m.recipe.padEnd(16)} ${m.commit_kind.padEnd(8)} ${m.catalog_ids.join(",")} (${m.files_changed_count} arq., ${m.lines_changed} linhas)`);
        }
    });
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
