import { ContractValidator } from "../../../core/schema/ContractValidator";
import { AccountResponse } from "../../../domains/account/AccountResponse";
import { AccountResponseSchema } from "../../../domains/account/AccountResponseSchema";
import { AccountStatus } from "../../../domains/account/AccountStatus";
import { PostAccountBody } from "../../../domains/account/PostAccountBody";
import { expect } from "../../../fixtures/ApiFixtures";
import { AccountInterface } from "../../../interfaces/AccountInterface";

/**
 * Contas de teste.
 *
 * Cada teste abre as próprias contas pela API (`POST /accounts`), então não há dependência de seed
 * nem de "contas limpas": a suíte roda contra um banco recém-criado e em paralelo.
 */

function checkDigit(digits: number[]): number {
    const weightStart = digits.length + 1;
    const sum = digits.reduce((acc, d, i) => acc + d * (weightStart - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
}

/** CPF válido aleatório (11 dígitos, sem máscara, nunca uma sequência repetida). */
export function validCpf(): string {
    let base: number[];
    do {
        base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    } while (base.every((d) => d === base[0]));
    const d1 = checkDigit(base);
    const d2 = checkDigit([...base, d1]);
    return [...base, d1, d2].join("");
}

export function buildAccountBody(overrides: Partial<PostAccountBody> = {}): PostAccountBody {
    return { name: "Cliente de Teste", document: validCpf(), ...overrides };
}

export type OpenAccountOptions = {
    initialDeposit?: number,
    branch?: string,
    status?: AccountStatus,
    name?: string,
};

/**
 * Abre uma conta e, se pedido, leva ao status final:
 * - `Blocked`: bloqueia com motivo;
 * - `Closed`: exige `initialDeposit` 0 (conta com saldo não pode ser encerrada).
 */
export async function openAccount(
    accountService: AccountInterface,
    { initialDeposit = 100, branch, status = "Active", name }: OpenAccountOptions = {}
): Promise<AccountResponse> {
    const body = buildAccountBody({ initialDeposit, ...(branch ? { branch } : {}), ...(name ? { name } : {}) });
    const res = await accountService.PostAccount(body);
    expect(res.status, `POST /accounts: ${res.text}`).toBe(201);
    ContractValidator.validate(AccountResponseSchema, res.body);
    const account = res.body;
    if (status === "Active") return account;

    if (status === "Closed") expect(initialDeposit, "conta Closed precisa abrir sem saldo").toBe(0);
    const change = await accountService.PatchAccountStatus(account.accountId, { status, reason: "Preparação de teste" });
    expect(change.status, `PATCH status ${status}: ${change.text}`).toBe(200);
    return { ...account, status, statusReason: "Preparação de teste" };
}

/** Atalho: abre uma conta Active e devolve só o id. */
export async function openAccountId(accountService: AccountInterface, options: OpenAccountOptions = {}): Promise<string> {
    return (await openAccount(accountService, options)).accountId;
}
