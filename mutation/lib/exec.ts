import { spawn } from "node:child_process";

export type ExecResult = { code: number, stdout: string, stderr: string, timedOut: boolean };

export function exec(
    command: string,
    args: string[],
    options: { cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, input?: string } = {}
): Promise<ExecResult> {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: ["pipe", "pipe", "pipe"],
            detached: true,
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        const timer = options.timeoutMs
            ? setTimeout(() => {
                timedOut = true;
                try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
            }, options.timeoutMs)
            : undefined;
        child.on("close", (code) => {
            if (timer) clearTimeout(timer);
            resolve({ code: code ?? 1, stdout, stderr, timedOut });
        });
        if (options.input) child.stdin.write(options.input);
        child.stdin.end();
    });
}

export async function mustExec(command: string, args: string[], options: Parameters<typeof exec>[2] = {}): Promise<string> {
    const res = await exec(command, args, options);
    if (res.code !== 0) throw new Error(`${command} ${args.join(" ")} falhou (${res.code}): ${res.stderr || res.stdout}`.slice(0, 4000));
    return res.stdout;
}

export function tail(text: string, lines = 40): string {
    return text.split("\n").slice(-lines).join("\n");
}
