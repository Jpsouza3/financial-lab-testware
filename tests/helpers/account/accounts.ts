import { HttpResponse } from "../../../core/http/HttpResponse";
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

function checkRest(digits: number[]): number {
    const weightStart = digits.length + 1;
    const sum = digits.reduce((acc, d, i) => acc + d * (weightStart - i), 0);
    return (sum * 10) % 11;
}

function checkDigit(digits: number[]): number {
    const rest = checkRest(digits);
    return rest === 10 ? 0 : rest;
}

function randomBase(): number[] {
    let base: number[];
    do {
        base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    } while (base.every((d) => d === base[0]));
    return base;
}

/** CPF válido em que o cálculo do 1º (`position` 1) ou do 2º (`position` 2) dígito dá resto 10, ou seja, dígito 0. */
export function validCpfWithRestTen(position: 1 | 2): string {
    for (;;) {
        const base = randomBase();
        const d1 = checkDigit(base);
        const rest = position === 1 ? checkRest(base) : checkRest([...base, d1]);
        if (rest === 10) return [...base, d1, checkDigit([...base, d1])].join("");
    }
}

/** Troca o dígito verificador `position` (1 ou 2) de um CPF por outro valor. */
export function withWrongCheckDigit(cpf: string, position: 1 | 2): string {
    const index = 8 + position;
    const wrong = (Number(cpf[index]) + 1) % 10;
    return cpf.slice(0, index) + wrong + cpf.slice(index + 1);
}

/** CPF válido aleatório (11 dígitos, sem máscara, nunca uma sequência repetida). */
export function validCpf(): string {
    const base = randomBase();
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

/** Corpo propositalmente inválido (campo ausente ou tipo errado) para os casos de validação. */
export function invalidAccountBody(body: Record<string, unknown>): PostAccountBody {
    return body as unknown as PostAccountBody;
}

export async function getAccount(accountService: AccountInterface, accountId: string): Promise<AccountResponse> {
    const res = await accountService.GetAccount(accountId);
    expect(res.status, `GET /accounts/${accountId}: ${res.text}`).toBe(200);
    ContractValidator.validate(AccountResponseSchema, res.body);
    return res.body;
}

/** 201 + Location + contrato + conta Active, sem motivo, sem saldo bloqueado e com balance igual ao depósito. */
export function expectAccountCreated(res: HttpResponse<AccountResponse>, body: PostAccountBody): AccountResponse {
    expect(res.status, res.text).toBe(201);
    ContractValidator.validate(AccountResponseSchema, res.body);
    const account = res.body;
    expect(res.headers["location"]).toMatch(new RegExp(`/accounts/${account.accountId}$`, "i"));
    const deposit = body.initialDeposit ?? 0;
    expect(account).toMatchObject({
        document: body.document,
        branch: body.branch ?? "0001",
        status: "Active",
        statusReason: null,
        blockedBalance: 0,
    });
    expect(account.balance).toBeCloseTo(deposit, 2);
    expect(account.availableBalance).toBeCloseTo(deposit, 2);
    expect(account.openedAt).toMatch(/Z$/);
    return account;
}
