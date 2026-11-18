/**
 * Liberar Bloqueio de Saldo (v1.0.0) — DELETE /accounts/{accountId}/holds/{holdId}
 *
 * Regra: liberar um bloqueio Active responde 200 com status Released e releasedAt; blockedBalance − amount,
 * availableBalance + amount, balance igual, version + 1. Liberação repetida devolve o mesmo corpo sem efeito.
 * Bloqueio Expired: 409. Ids que não são guid: 404 sem corpo; conta inexistente e bloqueio inexistente ou de outra
 * conta: 404. Expiração: o processo interno (a cada 5 s) passa a Expired os bloqueios vencidos, com o mesmo efeito
 * no saldo. Liberar ou expirar abre vaga no limite de 5 bloqueios e não gera lançamento no extrato.
 *
 * Contas: cada teste abre as próprias contas pela API (tests/helpers/account/accounts.ts).
 * Fora do escopo (v1.0.0): "bloqueio sem expiresAt nunca expira" (não há janela finita que prove "nunca").
 */
import { randomUUID } from "node:crypto";
import { ContractValidator } from "../../core/schema/ContractValidator";
import { HoldResponse } from "../../domains/account/HoldResponse";
import { HoldResponseSchema } from "../../domains/account/HoldResponseSchema";
import { expect, test } from "../../fixtures/ApiFixtures";
import { openAccountId } from "../helpers/account/accounts";
import {
    buildHoldBody,
    cents,
    createHold,
    expectBalanceUnchanged,
    fillActiveHolds,
    getBalance,
    isoIn,
} from "../helpers/account/holds";
import { getStatement } from "../helpers/account/statement";
import { expectProblem } from "../helpers/common/problem";
import { AccountInterface } from "../../interfaces/AccountInterface";
import { GetBalanceResponse } from "../../domains/account/GetBalanceResponse";

const DETAIL = {
    accountNotFound: "Conta não encontrada.",
    holdNotFound: "Bloqueio não encontrado.",
    expired: "Bloqueio expirado não pode ser liberado.",
    limit: "Limite de 5 bloqueios ativos atingido.",
    activeHolds: "A conta possui bloqueios de saldo ativos.",
    nonZeroBalance: "A conta precisa estar com saldo zerado para ser encerrada.",
} as const;

const WORKER_INTERVAL_MS = 5_000;

function expectBalanceAfterRelease(before: GetBalanceResponse, after: GetBalanceResponse, amount: number): void {
    expect(after.balance).toBeCloseTo(before.balance, 2);
    expect(after.blockedBalance).toBeCloseTo(cents(before.blockedBalance - amount), 2);
    expect(after.availableBalance).toBeCloseTo(cents(before.availableBalance + amount), 2);
    expect(after.version).toBe(before.version + 1);
}

async function releaseHold(accountService: AccountInterface, accountId: string, holdId: string): Promise<HoldResponse> {
    const res = await accountService.DeleteHold(accountId, holdId);
    expect(res.status, res.text).toBe(200);
    ContractValidator.validate(HoldResponseSchema, res.body);
    return res.body;
}

/**
 * Espera os bloqueios chegarem a Expired até `graceMs` depois do maior expiresAt: o processo roda a cada 5 s,
 * então um bloqueio vencido deve expirar em até ~5 s (mais a folga).
 */
async function waitForExpiredWithin(
    accountService: AccountInterface,
    accountId: string,
    holds: HoldResponse[],
    graceMs: number
): Promise<HoldResponse[]> {
    const deadline = Math.max(...holds.map((h) => Date.parse(h.expiresAt!))) + graceMs;
    let current: HoldResponse[] = [];
    await expect
        .poll(
            async () => {
                current = await Promise.all(holds.map(async (h) => (await accountService.GetHold(accountId, h.holdId)).body));
                return current.map((h) => h.status);
            },
            {
                message: `bloqueios deveriam expirar em até ${graceMs} ms após o expiresAt`,
                timeout: Math.max(deadline - Date.now(), 1_000),
                intervals: [500],
            }
        )
        .toEqual(holds.map(() => "Expired"));
    return current;
}

test.describe("DELETE /accounts/{accountId}/holds/{holdId}", { tag: ["@account", "@spec:liberar-bloqueio-saldo"] }, () => {
    test.describe("liberação", () => {
        test("REL-01: Liberar bloqueio Active", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const hold = await createHold(accountService, accountId, { amount: 12.34, expiresAt: isoIn(60 * 60 * 1000) });
            const before = await getBalance(accountService, accountId);
            const startedAt = Date.now();

            const released = await releaseHold(accountService, accountId, hold.holdId);

            expect(released).toMatchObject({ ...hold, status: "Released", releasedAt: expect.stringMatching(/Z$/) });
            expect(Date.parse(released.releasedAt!)).toBeGreaterThanOrEqual(startedAt - 1_000);
            expect(Date.parse(released.releasedAt!)).toBeLessThanOrEqual(Date.now() + 1_000);
            expectBalanceAfterRelease(before, await getBalance(accountService, accountId), 12.34);

            await test.step("consulta e listagem refletem o Released", async () => {
                expect((await accountService.GetHold(accountId, hold.holdId)).body).toEqual(released);
                const releasedList = (await accountService.GetHolds(accountId, "Released")).body;
                expect(releasedList.map((h) => h.holdId)).toEqual([hold.holdId]);
                expect((await accountService.GetHolds(accountId, "Active")).body).toEqual([]);
            });
        });

        test("REL-02: Liberar um de vários bloqueios só devolve o valor dele", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const kept = await createHold(accountService, accountId, { amount: 7 });
            const target = await createHold(accountService, accountId, { amount: 3.5 });
            const before = await getBalance(accountService, accountId);
            expect(before.blockedBalance).toBeCloseTo(10.5, 2);

            await releaseHold(accountService, accountId, target.holdId);

            const after = await getBalance(accountService, accountId);
            expectBalanceAfterRelease(before, after, 3.5);
            expect(after.blockedBalance).toBeCloseTo(7, 2);
            expect((await accountService.GetHold(accountId, kept.holdId)).body).toEqual(kept);
        });

        test("REL-03: Liberação repetida devolve o mesmo corpo sem novo efeito", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const hold = await createHold(accountService, accountId, { amount: 1 });
            const first = await releaseHold(accountService, accountId, hold.holdId);
            const before = await getBalance(accountService, accountId);

            const again = await releaseHold(accountService, accountId, hold.holdId);

            expect(again).toEqual(first);
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });

        test("REL-04: Conta Blocked pode ter bloqueio liberado", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const hold = await createHold(accountService, accountId, { amount: 2 });
            const change = await accountService.PatchAccountStatus(accountId, { status: "Blocked", reason: "Ordem judicial" });
            expect(change.status, change.text).toBe(200);
            const before = await getBalance(accountService, accountId);

            const released = await releaseHold(accountService, accountId, hold.holdId);

            expect(released.status).toBe("Released");
            const after = await getBalance(accountService, accountId);
            expect(after.status).toBe("Blocked");
            expectBalanceAfterRelease(before, after, 2);
        });

        test("REL-05: Liberação não gera lançamento no extrato", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 30 });
            const hold = await createHold(accountService, accountId, { amount: 10 });
            const statementBefore = await getStatement(accountService, accountId);

            await releaseHold(accountService, accountId, hold.holdId);

            expect(await getStatement(accountService, accountId)).toEqual(statementBefore);
        });

        test("REL-06: Liberar abre vaga no limite de 5 bloqueios ativos", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const holds = await fillActiveHolds(accountService, accountId, 5);
            expectProblem(await accountService.PostHold(accountId, buildHoldBody({ amount: 0.01 })), 422, DETAIL.limit);

            await releaseHold(accountService, accountId, holds[2].holdId);

            await test.step("novo bloqueio é aceito", async () => {
                await createHold(accountService, accountId, { amount: 0.01 });
                expect((await accountService.GetHolds(accountId, "Active")).body).toHaveLength(5);
            });

            await test.step("o seguinte volta a ser recusado", async () => {
                expectProblem(await accountService.PostHold(accountId, buildHoldBody({ amount: 0.01 })), 422, DETAIL.limit);
            });
        });

        test("REL-07: Liberar o último bloqueio ativo remove o impedimento de encerrar", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 1 });
            const hold = await createHold(accountService, accountId, { amount: 1 });

            await test.step("com bloqueio ativo: 422 de bloqueios", async () => {
                const res = await accountService.PatchAccountStatus(accountId, { status: "Closed", reason: "Pedido do cliente" });
                expectProblem(res, 422, DETAIL.activeHolds);
            });

            await releaseHold(accountService, accountId, hold.holdId);

            await test.step("sem bloqueio ativo: a regra seguinte (saldo) é que impede", async () => {
                const res = await accountService.PatchAccountStatus(accountId, { status: "Closed", reason: "Pedido do cliente" });
                expectProblem(res, 422, DETAIL.nonZeroBalance);
            });
        });
    });

    test.describe("não encontrado", () => {
        test("REL-08: accountId ou holdId que não é guid", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const hold = await createHold(accountService, accountId, { amount: 0.01 });
            const before = await getBalance(accountService, accountId);

            for (const [label, account, holdId] of [
                ["holdId inválido", accountId, "nao-e-guid"],
                ["accountId inválido", "nao-e-guid", hold.holdId],
                ["holdId numérico", accountId, "123"],
            ] as const) {
                await test.step(`404 sem corpo: ${label}`, async () => {
                    const res = await accountService.DeleteHold(account, holdId);
                    expect(res.status).toBe(404);
                    expect(res.text).toBe("");
                });
            }
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });

        test("REL-09: Conta inexistente", async ({ accountService }) => {
            expectProblem(await accountService.DeleteHold(randomUUID(), randomUUID()), 404, DETAIL.accountNotFound);
        });

        test("REL-10: Bloqueio inexistente", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);

            expectProblem(await accountService.DeleteHold(accountId, randomUUID()), 404, DETAIL.holdNotFound);
        });

        test("REL-11: Bloqueio de outra conta não é liberado", async ({ accountService }) => {
            const owner = await openAccountId(accountService);
            const other = await openAccountId(accountService);
            const hold = await createHold(accountService, owner, { amount: 5 });
            const ownerBefore = await getBalance(accountService, owner);
            const otherBefore = await getBalance(accountService, other);

            expectProblem(await accountService.DeleteHold(other, hold.holdId), 404, DETAIL.holdNotFound);

            expect((await accountService.GetHold(owner, hold.holdId)).body).toEqual(hold);
            expectBalanceUnchanged(ownerBefore, await getBalance(accountService, owner));
            expectBalanceUnchanged(otherBefore, await getBalance(accountService, other));
        });
    });

    test.describe("expiração", () => {
        test("REL-12: Bloqueio vencido expira em até ~5 s com o mesmo efeito da liberação", async ({ accountService }) => {
            test.setTimeout(60_000);
            const accountId = await openAccountId(accountService, { initialDeposit: 30 });
            const hold = await createHold(accountService, accountId, { amount: 4.2, expiresAt: isoIn(11_000) });
            const before = await getBalance(accountService, accountId);
            const statementBefore = await getStatement(accountService, accountId);

            const [expired] = await waitForExpiredWithin(accountService, accountId, [hold], WORKER_INTERVAL_MS + 4_000);

            expect(expired).toMatchObject({ ...hold, status: "Expired", releasedAt: expect.stringMatching(/Z$/) });
            expect(Date.parse(expired.releasedAt!)).toBeGreaterThanOrEqual(Date.parse(hold.expiresAt!));
            expectBalanceAfterRelease(before, await getBalance(accountService, accountId), 4.2);
            expect(await getStatement(accountService, accountId)).toEqual(statementBefore);
            expect((await accountService.GetHolds(accountId, "Expired")).body.map((h) => h.holdId)).toEqual([hold.holdId]);
        });

        test("REL-13: Vários bloqueios vencidos ao mesmo tempo expiram juntos", async ({ accountService }) => {
            test.setTimeout(60_000);
            const accountId = await openAccountId(accountService, { initialDeposit: 30 });
            const expiresAt = isoIn(12_000);
            const holds: HoldResponse[] = [];
            for (let i = 0; i < 5; i++) holds.push(await createHold(accountService, accountId, { amount: 1, expiresAt }));
            const before = await getBalance(accountService, accountId);
            expect(before.blockedBalance).toBeCloseTo(5, 2);

            await waitForExpiredWithin(accountService, accountId, holds, WORKER_INTERVAL_MS + 4_000);

            const after = await getBalance(accountService, accountId);
            expect(after.blockedBalance).toBeCloseTo(0, 2);
            expect(after.availableBalance).toBeCloseTo(after.balance, 2);
            expect(after.version).toBe(before.version + 5);
        });

        test("REL-14: Bloqueio Expired não pode ser liberado", async ({ accountService }) => {
            test.setTimeout(60_000);
            const accountId = await openAccountId(accountService);
            const hold = await createHold(accountService, accountId, { amount: 1, expiresAt: isoIn(11_000) });
            const [expired] = await waitForExpiredWithin(accountService, accountId, [hold], WORKER_INTERVAL_MS + 20_000);
            const before = await getBalance(accountService, accountId);

            expectProblem(await accountService.DeleteHold(accountId, hold.holdId), 409, DETAIL.expired);

            expect((await accountService.GetHold(accountId, hold.holdId)).body).toEqual(expired);
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });

        test("REL-15: Bloqueio liberado antes do vencimento não volta a mudar", async ({ accountService }) => {
            test.setTimeout(60_000);
            const accountId = await openAccountId(accountService);
            const hold = await createHold(accountService, accountId, { amount: 1, expiresAt: isoIn(11_000) });
            const released = await releaseHold(accountService, accountId, hold.holdId);
            const before = await getBalance(accountService, accountId);

            await test.step("janela fixa: passa o vencimento e mais um ciclo do processo de expiração", async () => {
                const waitMs = Date.parse(hold.expiresAt!) + WORKER_INTERVAL_MS + 2_000 - Date.now();
                await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 0)));
            });

            expect((await accountService.GetHold(accountId, hold.holdId)).body).toEqual(released);
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });
    });
});
