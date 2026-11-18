import fs from "node:fs";
import path from "node:path";
import { mustExec } from "./exec";
import { SUT_PATH, WORK_DIR } from "./paths";

/** Worktree descartável do SUT em `sha` (fora do `main`, apagada no fim). */
export async function withWorktree<T>(name: string, sha: string, fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = path.join(WORK_DIR, name);
    await removeWorktree(dir);
    fs.mkdirSync(WORK_DIR, { recursive: true });
    await mustExec("git", ["-C", SUT_PATH, "worktree", "add", "--detach", "--force", dir, sha]);
    try {
        return await fn(dir);
    } finally {
        await removeWorktree(dir);
    }
}

async function removeWorktree(dir: string): Promise<void> {
    if (fs.existsSync(dir)) {
        await mustExec("git", ["-C", SUT_PATH, "worktree", "remove", "--force", dir]).catch(() => fs.rmSync(dir, { recursive: true, force: true }));
    }
    await mustExec("git", ["-C", SUT_PATH, "worktree", "prune"]).catch(() => undefined);
}

export async function resetTree(dir: string, sha: string): Promise<void> {
    await mustExec("git", ["-C", dir, "reset", "--hard", "-q", sha]);
    await mustExec("git", ["-C", dir, "clean", "-fdq"]);
}

export type DiffInfo = { patch: string, files: string[], linesAdded: number, linesRemoved: number };

export async function diffAgainst(dir: string, sha: string): Promise<DiffInfo> {
    await mustExec("git", ["-C", dir, "add", "-A"]);
    const patch = await mustExec("git", ["-C", dir, "diff", "--cached", "--binary", sha]);
    const numstat = await mustExec("git", ["-C", dir, "diff", "--cached", "--numstat", sha]);
    let linesAdded = 0;
    let linesRemoved = 0;
    const files: string[] = [];
    for (const line of numstat.trim().split("\n").filter(Boolean)) {
        const [added, removed, file] = line.split("\t");
        linesAdded += Number(added) || 0;
        linesRemoved += Number(removed) || 0;
        files.push(file);
    }
    return { patch, files, linesAdded, linesRemoved };
}
