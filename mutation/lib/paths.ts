import fs from "node:fs";
import path from "node:path";

export const MUTATION_DIR = path.resolve(__dirname, "..");
export const TESTWARE_DIR = path.resolve(MUTATION_DIR, "..");
export const COMMITS_DIR = path.join(MUTATION_DIR, "commits");
export const RESULTS_DIR = path.join(MUTATION_DIR, "results");
export const WORK_DIR = process.env.MUTATION_WORK_DIR ?? path.join(MUTATION_DIR, ".work");
export const SUT_PATH = path.resolve(process.env.SUT_PATH ?? path.join(TESTWARE_DIR, "..", "financial-lab-account"));

export type BaseInfo = { sut_repo: string, base_ref: string, base_sha: string, suite_tag: string };

export function readBase(): BaseInfo {
    return JSON.parse(fs.readFileSync(path.join(MUTATION_DIR, "base.json"), "utf8"));
}

export function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, data: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
