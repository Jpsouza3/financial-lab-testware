import fs from "node:fs";
import path from "node:path";
import { exec, mustExec, tail } from "./exec";
import { API_SERVICES, ApiService } from "./services";
import { SuiteUrls } from "./suite";

export type Images = Record<ApiService | "migrations", string>;

export function slotPorts(slot: number) {
    const base = 20000 + slot * 100;
    return {
        POSTGRES_PORT: base + 33, RABBITMQ_PORT: base + 72, RABBITMQ_UI_PORT: base + 73,
        ACCOUNT_API_PORT: base + 57, TRANSFER_API_PORT: base + 58, ANTIFRAUD_API_PORT: base + 59,
    };
}

export function slotUrls(slot: number): SuiteUrls {
    const p = slotPorts(slot);
    return {
        account: `http://localhost:${p.ACCOUNT_API_PORT}`,
        transfer: `http://localhost:${p.TRANSFER_API_PORT}`,
        antifraud: `http://localhost:${p.ANTIFRAUD_API_PORT}`,
    };
}

const TARGET: Record<ApiService | "migrations", string> = {
    account: "account-api", transfer: "transfer-api", antifraud: "antifraud-api", migrations: "migrations",
};

async function imageExists(tag: string): Promise<boolean> {
    return (await exec("docker", ["image", "inspect", tag])).code === 0;
}

export async function buildImage(dir: string, service: ApiService | "migrations", tag: string, timeoutMs: number): Promise<string | null> {
    const res = await exec("docker", ["build", "-q", "--target", TARGET[service], "-t", tag, dir], {
        timeoutMs, env: { DOCKER_BUILDKIT: "1" },
    });
    if (res.code === 0) return null;
    return res.timedOut ? "timeout no build" : tail(res.stderr || res.stdout, 30);
}

/** Imagens da base (construídas uma vez por SHA). */
export async function ensureBaseImages(dir: string, sha: string, timeoutMs: number): Promise<Images> {
    const short = sha.slice(0, 12);
    const images = {} as Images;
    for (const service of [...API_SERVICES, "migrations"] as const) {
        const tag = `flmut/${TARGET[service]}:${short}`;
        if (!(await imageExists(tag))) {
            const error = await buildImage(dir, service, tag, timeoutMs);
            if (error) throw new Error(`build da base (${service}) falhou:\n${error}`);
        }
        images[service] = tag;
    }
    return images;
}

function composeEnv(slot: number, images: Images): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ACCOUNT_API_IMAGE: images.account, TRANSFER_API_IMAGE: images.transfer,
        ANTIFRAUD_API_IMAGE: images.antifraud, MIGRATIONS_IMAGE: images.migrations,
    };
    for (const [k, v] of Object.entries(slotPorts(slot))) env[k] = String(v);
    return env;
}

function composeArgs(dir: string, slot: number, overrideFile?: string): string[] {
    return ["compose", "-f", path.join(dir, "docker-compose.yml"), ...(overrideFile ? ["-f", overrideFile] : []), "-p", `flmut-${slot}`];
}

export async function stackDown(dir: string, slot: number, images: Images, overrideFile?: string): Promise<void> {
    await exec("docker", [...composeArgs(dir, slot, overrideFile), "down", "-v", "--remove-orphans", "-t", "5"], { env: composeEnv(slot, images), timeoutMs: 120_000 });
}

export async function stackUp(dir: string, slot: number, images: Images, overrideFile?: string): Promise<string | null> {
    const env = composeEnv(slot, images);
    let last = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
        await stackDown(dir, slot, images, overrideFile);
        const res = await exec("docker", [...composeArgs(dir, slot, overrideFile), "up", "-d", "--no-build", "--wait", "--wait-timeout", "180"], { env, timeoutMs: 300_000 });
        if (res.code === 0) return null;
        last = tail(res.stderr || res.stdout, 20);
    }
    return last;
}

export async function removeImages(tags: string[]): Promise<void> {
    if (tags.length) await exec("docker", ["rmi", "-f", ...tags]);
}

export function writeDelayOverride(file: string, delayMs: number): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `services:\n  antifraud-api:\n    environment:\n      Antifraud__DefaultDelayMs: "${delayMs}"\n`);
    return file;
}

export { mustExec };
