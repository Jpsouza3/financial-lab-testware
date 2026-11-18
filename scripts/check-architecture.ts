/**
 * Verifica as regras de dependência entre camadas descritas em ARCHITECTURE.md.
 *
 * Uso: npm run lint:arch
 * Sai com código 1 e lista `arquivo:linha` de cada violação.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Layer =
    | "core/http" | "core/schema" | "core/config" | "domains" | "interfaces"
    | "services" | "fixtures" | "tests/helpers" | "tests" | "other";

/** Camadas internas que cada camada pode importar. */
const ALLOWED_LAYERS: Record<Layer, Layer[]> = {
    "core/http": ["core/http"],
    "core/schema": ["core/schema"],
    "core/config": ["core/config"],
    domains: ["domains", "core/schema"],
    interfaces: ["interfaces", "domains", "core/http"],
    services: ["services", "interfaces", "domains", "core/http"],
    fixtures: ["fixtures", "core/config", "core/http", "interfaces", "services"],
    "tests/helpers": ["tests/helpers", "fixtures", "core/config", "core/http", "core/schema", "domains", "interfaces"],
    tests: ["tests/helpers", "fixtures", "core/config", "core/http", "core/schema", "domains", "interfaces"],
    other: [],
};

/** Pacotes externos que cada camada pode importar (`node:*` é livre). */
const ALLOWED_PACKAGES: Partial<Record<Layer, string[]>> = {
    "core/http": ["@playwright/test"], // restrito a PlaywrightHttpClient.ts abaixo
    "core/schema": ["ajv", "ajv-formats"],
    "core/config": ["dotenv"],
    domains: [],
    interfaces: [],
    services: [],
    fixtures: ["@playwright/test"],
    "tests/helpers": [],
    tests: [],
};

/** Únicos arquivos que podem ler `process.env`. */
const PROCESS_ENV_ALLOWED = [/^core\/config\//, /^playwright\.config\.ts$/, /^scripts\//];

/** Único arquivo de `core/http` acoplado ao Playwright (o adapter). */
const PLAYWRIGHT_ADAPTER = "core/http/PlaywrightHttpClient.ts";

function layerOf(file: string): Layer {
    for (const layer of ["core/http", "core/schema", "core/config", "tests/helpers"] as const) {
        if (file.startsWith(`${layer}/`)) return layer;
    }
    const top = file.split("/")[0];
    if (top === "domains" || top === "interfaces" || top === "services" || top === "fixtures" || top === "tests") return top;
    return "other";
}

function packageName(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const files = execSync("git ls-files -co --exclude-standard", { encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && fs.existsSync(f));

const IMPORT = /(?:^|\s)(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const violations: string[] = [];

for (const file of files) {
    const layer = layerOf(file);
    const lines = fs.readFileSync(file, "utf8").split("\n");

    lines.forEach((line, i) => {
        const where = `${file}:${i + 1}`;

        if (/\bprocess\.env\b/.test(line) && !PROCESS_ENV_ALLOWED.some((re) => re.test(file))) {
            violations.push(`${where}: process.env fora de core/config (use config.<chave>)`);
        }

        if (layer === "other") return;
        for (const match of line.matchAll(IMPORT)) {
            const specifier = match[1] ?? match[2];

            if (specifier.startsWith(".")) {
                const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
                const targetLayer = layerOf(target);
                if (!ALLOWED_LAYERS[layer].includes(targetLayer)) {
                    violations.push(`${where}: ${layer} não pode importar ${targetLayer} (${specifier})`);
                }
                continue;
            }

            if (specifier.startsWith("node:")) continue;
            const pkg = packageName(specifier);
            const allowed = ALLOWED_PACKAGES[layer] ?? [];
            if (!allowed.includes(pkg)) {
                const hint = pkg === "@playwright/test" && layer.startsWith("tests")
                    ? " (importe test/expect de fixtures/ApiFixtures)"
                    : "";
                violations.push(`${where}: ${layer} não pode importar o pacote ${pkg}${hint}`);
            } else if (pkg === "@playwright/test" && layer === "core/http" && file !== PLAYWRIGHT_ADAPTER) {
                violations.push(`${where}: só ${PLAYWRIGHT_ADAPTER} pode importar @playwright/test em core/http`);
            }
        }
    });
}

if (violations.length) {
    console.error(`Violações de arquitetura (${violations.length}):\n${violations.map((v) => `  ${v}`).join("\n")}`);
    process.exit(1);
}
console.log(`Arquitetura ok (${files.length} arquivos .ts verificados).`);
