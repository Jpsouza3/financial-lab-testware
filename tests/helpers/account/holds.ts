import { HttpResponse } from "../../../core/http/HttpResponse";
import { ContractValidator } from "../../../core/schema/ContractValidator";
import { GetBalanceResponse } from "../../../domains/account/GetBalanceResponse";
import { GetBalanceResponseSchema } from "../../../domains/account/GetBalanceResponseSchema";
import { HoldResponse } from "../../../domains/account/HoldResponse";
import { HoldResponseSchema } from "../../../domains/account/HoldResponseSchema";
import { HoldStatus } from "../../../domains/account/HoldStatus";
import { PostHoldBody } from "../../../domains/account/PostHoldBody";
import { TransferResponse } from "../../../domains/transfer/TransferResponse";
import { expect } from "../../../fixtures/ApiFixtures";
import { AccountInterface } from "../../../interfaces/AccountInterface";
import { TransferInterface } from "../../../interfaces/TransferInterface";

/** Arredonda para centavos (evita erro de ponto flutuante nas contas de saldo). */
export const cents = (n: number): number => Math.round(n * 100) / 100;

/** reference única, até 32 caracteres `[A-Za-z0-9_-]`. */
export function uniqueReference(prefix = "hld"): string {
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${rand}`.slice(0, 32);
}

export function buildHoldBody(overrides: Partial<PostHoldBody> = {}): PostHoldBody {
    return {
        reference: uniqueReference(),
        amount: 1.0,
        reason: "Teste automatizado",
        ...overrides,
    };
}

/** Corpo propositalmente inválido (campo ausente ou tipo errado) para os casos de validação. */
export function invalidHoldBody(body: Record<string, unknown>): PostHoldBody {
    return body as unknown as PostHoldBody;
}

/** Instante ISO 8601 daqui a `ms`, em UTC (`Z`) ou com o deslocamento informado (ex.: -180 → `-03:00`). */
export function isoIn(ms: number, offsetMinutes = 0): string {
    const instant = new Date(Date.now() + ms);
    if (!offsetMinutes) return instant.toISOString();
    const local = new Date(instant.getTime() + offsetMinutes * 60_000).toISOString().slice(0, -1);
    const abs = Math.abs(offsetMinutes);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${local}${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export async function getBalance(accountService: AccountInterface, accountId: string): Promise<GetBalanceResponse> {
    const res = await accountService.GetBalance(accountId);
    expect(res.status, `GET balance ${accountId}`).toBe(200);
    ContractValidator.validate(GetBalanceResponseSchema, res.body);
    return res.body;
}

/** Cria um bloqueio e afirma 201. */
export async function createHold(
    accountService: AccountInterface,
    accountId: string,
    overrides: Partial<PostHoldBody> = {}
): Promise<HoldResponse> {
    const body = buildHoldBody(overrides);
    const res = await accountService.PostHold(accountId, body);
    expect(res.status, `POST hold ${body.reference}: ${res.text}`).toBe(201);
    return res.body;
}

/** Cria `count` bloqueios Active de 0,01. */
export async function fillActiveHolds(accountService: AccountInterface, accountId: string, count: number): Promise<HoldResponse[]> {
    const holds: HoldResponse[] = [];
    for (let i = 0; i < count; i++) holds.push(await createHold(accountService, accountId, { amount: 0.01 }));
    return holds;
}

/** 201 + Location + contrato + campos iguais aos enviados, status Active. */
export function expectHoldCreated(res: HttpResponse<HoldResponse>, body: PostHoldBody, accountId: string): HoldResponse {
    expect(res.status, res.text).toBe(201);
    ContractValidator.validate(HoldResponseSchema, res.body);
    const hold = res.body;
    expect(res.headers["location"]).toMatch(new RegExp(`/accounts/${accountId}/holds/${hold.holdId}$`, "i"));
    expect(hold).toMatchObject({
        accountId,
        reference: body.reference,
        amount: body.amount,
        reason: body.reason.trim(),
        status: "Active",
        releasedAt: null,
    });
    expect(hold.createdAt).toMatch(/Z$/);
    return hold;
}

/** Efeito da criação: blockedBalance + amount, availableBalance − amount, balance igual, version + 1. */
export function expectBalanceAfterHold(before: GetBalanceResponse, after: GetBalanceResponse, amount: number): void {
    expect(after.balance).toBeCloseTo(before.balance, 2);
    expect(after.blockedBalance).toBeCloseTo(cents(before.blockedBalance + amount), 2);
    expect(after.availableBalance).toBeCloseTo(cents(before.availableBalance - amount), 2);
    expect(after.version).toBe(before.version + 1);
}

/** Nenhum efeito no saldo nem na version. */
export function expectBalanceUnchanged(before: GetBalanceResponse, after: GetBalanceResponse): void {
    expect(after).toEqual(before);
}

export async function waitForHoldStatus(
    accountService: AccountInterface,
    accountId: string,
    holdId: string,
    status: HoldStatus,
    timeout = 60_000
): Promise<void> {
    await expect
        .poll(async () => (await accountService.GetHold(accountId, holdId)).body.status, {
            message: `bloqueio ${holdId} deveria chegar a ${status}`,
            timeout,
            intervals: [1_000],
        })
        .toBe(status);
}

/** Consulta a transferência até um status final (Completed ou Failed). */
export async function waitForTransferFinal(
    transferService: TransferInterface,
    transferId: string,
    timeout = 30_000
): Promise<TransferResponse> {
    let last: TransferResponse | undefined;
    await expect
        .poll(
            async () => {
                last = (await transferService.GetTransfer(transferId)).body;
                return last.status;
            },
            { message: `transferência ${transferId} deveria terminar`, timeout, intervals: [1_000] }
        )
        .toMatch(/^(Completed|Failed)$/);
    return last!;
}
