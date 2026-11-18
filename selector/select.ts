import fs from "node:fs";
import path from "node:path";
import { serviceOfFile } from "../mutation/lib/services";

export type SelectableTest = { test_id: string, tags: string[] };
export type ServiceMap = {
    services: Record<string, string[]>,
    ignoredFiles: string[],
    runAllFiles: string[],
    recentFailuresWindow: number,
};

export type Selection = { mode: "all" | "subset" | "none", reason: string, tests: string[], tags: string[] };

export function loadServiceMap(): ServiceMap {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "service-map.json"), "utf8"));
}

/**
 * Seletor baseline determinístico: testes das tags dos serviços tocados + testes que falharam recentemente.
 * Arquivos de infraestrutura (Dockerfile, compose, Contracts, migrações) ou desconhecidos levam à suíte completa.
 */
export function selectTests(changedFiles: string[], tests: SelectableTest[], recentFailures: Iterable<string>, map = loadServiceMap()): Selection {
    const relevant = changedFiles.filter((f) => !map.ignoredFiles.some((p) => new RegExp(p).test(f)));
    const all = tests.map((t) => t.test_id);
    const runAll = relevant.find((f) => map.runAllFiles.some((p) => new RegExp(p).test(f)) || serviceOfFile(f) === "docs");
    if (runAll) return { mode: "all", reason: `arquivo fora do mapa: ${runAll}`, tests: all, tags: [] };

    const tags = [...new Set(relevant.flatMap((f) => map.services[serviceOfFile(f)] ?? []))];
    const recent = new Set(recentFailures);
    const selected = tests.filter((t) => t.tags.some((tag) => tags.includes(tag)) || recent.has(t.test_id)).map((t) => t.test_id);
    if (!selected.length) return { mode: "none", reason: "só arquivos ignorados", tests: [], tags };
    return { mode: "subset", reason: `serviços: ${tags.join(", ")}; falhas recentes: ${recent.size}`, tests: selected, tags };
}
