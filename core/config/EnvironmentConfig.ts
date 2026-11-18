import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { EnvReader } from "./EnvReader";

/**
 * Configuração do testware: o único lugar que lê `process.env` (verificado por `npm run lint:arch`).
 *
 * Ordem de precedência:
 * 1. variáveis já definidas no processo (CI, `VAR=x npx playwright test`);
 * 2. arquivo `.env.<ENV>` na raiz (`ENV` padrão: `local`), se existir.
 *
 * O arquivo é opcional: em CI basta exportar as variáveis. Toda variável nova entra
 * aqui e em `.env.example`.
 */
export const environment = process.env.ENV?.trim() || "local";

const envFile = path.resolve(process.cwd(), `.env.${environment}`);
const hasEnvFile = fs.existsSync(envFile);

if (hasEnvFile) {
    const result = dotenv.config({ path: envFile, quiet: true, override: false });
    if (result.error) throw result.error;
}

const env = new EnvReader(process.env, hasEnvFile ? envFile : `process.env (sem .env.${environment})`);

export const config = Object.freeze({
    environment,

    // APIs
    accountApiUrl: env.url("ACCOUNT_API_URL"),
    transferApiUrl: env.url("TRANSFER_API_URL"),

    // Contas de teste pré-existentes (o testware não cria contas). Opcionais: o teste que depende faz `test.skip`.
    activeAccountIds: Object.freeze(env.list("ACTIVE_ACCOUNT_IDS")),
    blockedAccountId: env.optional("BLOCKED_ACCOUNT_ID"),
    closedAccountId: env.optional("CLOSED_ACCOUNT_ID"),
});

env.assertValid();

export type Config = typeof config;
