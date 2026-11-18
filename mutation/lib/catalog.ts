import fs from "node:fs";
import path from "node:path";
import { MUTATION_DIR, readJson } from "./paths";

export type CatalogKind = "breaking" | "neutral" | "additive" | "config";
export type Service = "account" | "transfer" | "antifraud" | "docs";

export type Edit =
    | { find: string, replace: string, regex?: boolean, all?: boolean }
    | { create: true, content: string };

export type CatalogItem = {
    id: string,
    kind: CatalogKind,
    service: Service,
    file: string,
    description: string,
    expected?: string,
    edits: Edit[],
};

export type Catalog = { version: number, items: CatalogItem[] };

export function loadCatalog(): Catalog {
    return readJson<Catalog>(path.join(MUTATION_DIR, "catalog.json"));
}

function countOccurrences(text: string, needle: string): number {
    let count = 0;
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) count++;
    return count;
}

/** Aplica um item numa árvore do SUT. Devolve o motivo da falha, ou null se aplicou. */
export function applyItem(root: string, item: CatalogItem): string | null {
    const file = path.join(root, item.file);
    const original = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    let text = original;

    for (const edit of item.edits) {
        if ("create" in edit) {
            if (text !== null) return `${item.id}: ${item.file} já existe`;
            text = edit.content;
            continue;
        }
        if (text === null) return `${item.id}: ${item.file} não existe`;
        if (edit.regex) {
            const re = new RegExp(edit.find, edit.all ? "g" : "");
            const matches = text.match(new RegExp(edit.find, "g"))?.length ?? 0;
            if (matches === 0 || (!edit.all && matches !== 1)) return `${item.id}: padrão ${edit.find} casou ${matches}x`;
            text = text.replace(re, edit.replace);
        } else {
            const matches = countOccurrences(text, edit.find);
            if (matches === 0 || (!edit.all && matches !== 1)) return `${item.id}: trecho casou ${matches}x`;
            text = edit.all ? text.split(edit.find).join(edit.replace) : text.replace(edit.find, () => edit.replace);
        }
    }

    if (text === original) return `${item.id}: sem efeito`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text!);
    return null;
}
