import { parseArgs } from "node:util";
import { applyItem, loadCatalog } from "./lib/catalog";
import { exec, mustExec, tail } from "./lib/exec";
import { readBase } from "./lib/paths";
import { resetTree, withWorktree } from "./lib/worktree";

const PROJECTS: Record<string, string> = {
    account: "financial-lab-account.Api/financial-lab-account.Api.csproj",
    transfer: "financial-lab-transfer.Api/financial-lab-transfer.Api.csproj",
    antifraud: "financial-lab-antifraud.Api/financial-lab-antifraud.Api.csproj",
};

async function main(): Promise<void> {
    const { values } = parseArgs({ options: { compile: { type: "boolean", default: false }, ids: { type: "string" } } });
    const base = readBase();
    const catalog = loadCatalog();
    const items = values.ids ? catalog.items.filter((i) => values.ids!.split(",").includes(i.id)) : catalog.items;
    let failures = 0;

    await withWorktree("validate", base.base_sha, async (dir) => {
        const container = "flmut-validate-sdk";
        if (values.compile) {
            await exec("docker", ["rm", "-f", container]);
            await mustExec("docker", ["run", "-d", "--name", container, "-v", `${dir}:/src`, "-w", "/src",
                "mcr.microsoft.com/dotnet/sdk:9.0", "sleep", "infinity"]);
            await mustExec("docker", ["exec", container, "dotnet", "restore", "financial-lab-account.sln"], { timeoutMs: 600_000 });
        }
        try {
            for (const item of items) {
                await resetTree(dir, base.base_sha);
                const error = applyItem(dir, item);
                if (error) { failures++; console.log(`FALHA ${item.id}: ${error}`); continue; }
                if (!values.compile || !PROJECTS[item.service]) { console.log(`ok    ${item.id}`); continue; }
                const build = await exec("docker", ["exec", container, "dotnet", "build", PROJECTS[item.service],
                    "--no-restore", "-c", "Release", "-v", "q", "-nologo", "-p:TreatWarningsAsErrors=false"], { timeoutMs: 300_000 });
                if (build.code !== 0) { failures++; console.log(`NÃO COMPILA ${item.id}:\n${tail(build.stdout, 8)}`); }
                else console.log(`ok    ${item.id} (compila)`);
            }
        } finally {
            if (values.compile) {
                await exec("docker", ["exec", container, "chown", "-R", `${process.getuid!()}:${process.getgid!()}`, "/src"]);
                await exec("docker", ["rm", "-f", container]);
            }
        }
    });
    console.log(`${items.length - failures}/${items.length} itens válidos`);
    process.exitCode = failures ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
