/**
 * Alterar Status da Conta (v1.0.0) — PATCH /accounts/{accountId}/status
 *
 * Regra: transições Active ↔ Blocked, Active/Blocked → Closed (terminal). Mudança efetiva: 200 changed true,
 * version + 1, statusReason = reason e changedAt = data da mudança. Status igual ao atual: 200 changed false, nada
 * gravado. Regras na ordem: status inválido (400), motivo ausente para Blocked/Closed (400), motivo fora de 5 a 200
 * (400), conta inexistente (404), conta Closed (409), encerrar com bloqueio ativo (422), encerrar com saldo (422).
 * Movimentação: Blocked recusa débito e aceita crédito; Closed recusa ambos (observado pela Transfer API).
 *
 * Contas: cada teste abre as próprias contas pela API (tests/helpers/account/accounts.ts).
 */
import { randomUUID } from "node:crypto";
import { ContractValidator } from "../../core/schema/ContractValidator";
import { PatchAccountStatusBody } from "../../domains/account/PatchAccountStatusBody";
import { PatchAccountStatusResponse } from "../../domains/account/PatchAccountStatusResponse";
import { PatchAccountStatusResponseSchema } from "../../domains/account/PatchAccountStatusResponseSchema";
import { HttpResponse } from "../../core/http/HttpResponse";
import { expect, test } from "../../fixtures/ApiFixtures";
import { getAccount, openAccount, openAccountId } from "../helpers/account/accounts";
import { cents, createHold, expectBalanceUnchanged, getBalance } from "../helpers/account/holds";
import { getStatement } from "../helpers/account/statement";
import { transferAndSettle } from "../helpers/account/transfers";
import { expectProblem } from "../helpers/common/problem";

const DETAIL = {
    status: "Status inválido. Valores aceitos: Active, Blocked, Closed.",
    reasonRequired: "O motivo é obrigatório para bloquear ou encerrar a conta.",
    reasonLength: "O motivo deve ter entre 5 e 200 caracteres.",
    accountNotFound: "Conta não encontrada.",
    closed: "Conta encerrada não pode ter o status alterado.",
    activeHolds: "A conta possui bloqueios de saldo ativos.",
    nonZeroBalance: "A conta precisa estar com saldo zerado para ser encerrada.",
    debitBlocked: "Conta Blocked: débito não permitido.",
    movementClosed: "Conta Closed: movimentação não permitida.",
} as const;

function invalidStatusBody(body: Record<string, unknown>): PatchAccountStatusBody {
    return body as unknown as PatchAccountStatusBody;
}

function expectChanged(
    res: HttpResponse<PatchAccountStatusResponse>,
    accountId: string,
    expected: Pick<PatchAccountStatusResponse, "previousStatus" | "status" | "reason">,
    startedAt: number
): PatchAccountStatusResponse {
    expect(res.status, res.text).toBe(200);
    ContractValidator.validate(PatchAccountStatusResponseSchema, res.body);
    expect(res.body).toMatchObject({ accountId, changed: true, ...expected });
    expect(res.body.changedAt).toMatch(/Z$/);
    expect(Date.parse(res.body.changedAt!)).toBeGreaterThanOrEqual(startedAt - 1_000);
    expect(Date.parse(res.body.changedAt!)).toBeLessThanOrEqual(Date.now() + 1_000);
    return res.body;
}

test.describe("PATCH /accounts/{accountId}/status", { tag: ["@account", "@spec:alterar-status-conta"] }, () => {
    test.describe("transições", () => {
        test("STS-01: Bloquear conta Active", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const before = await getBalance(accountService, accountId);
            const startedAt = Date.now();

            const res = await accountService.PatchAccountStatus(accountId, { status: "Blocked", reason: "Suspeita de fraude" });

            expectChanged(res, accountId, { previousStatus: "Active", status: "Blocked", reason: "Suspeita de fraude" }, startedAt);
            const after = await getBalance(accountService, accountId);
            expect(after).toEqual({ ...before, status: "Blocked", version: before.version + 1 });
            const account = await getAccount(accountService, accountId);
            expect(account).toMatchObject({ status: "Blocked", statusReason: "Suspeita de fraude" });
        });

        test("STS-02: Desbloquear sem reason limpa o statusReason", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { status: "Blocked" });
            const before = await getBalance(accountService, accountId);
            const startedAt = Date.now();

            const res = await accountService.PatchAccountStatus(accountId, { status: "Active" });

            expectChanged(res, accountId, { previousStatus: "Blocked", status: "Active", reason: null }, startedAt);
            expect((await getBalance(accountService, accountId)).version).toBe(before.version + 1);
            expect(await getAccount(accountService, accountId)).toMatchObject({ status: "Active", statusReason: null });
        });

        test("STS-03: Desbloquear com reason grava o novo motivo", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { status: "Blocked" });

            const res = await accountService.PatchAccountStatus(accountId, { status: "Active", reason: "Análise concluída" });

            expectChanged(res, accountId, { previousStatus: "Blocked", status: "Active", reason: "Análise concluída" }, Date.now() - 5_000);
            expect((await getAccount(accountService, accountId)).statusReason).toBe("Análise concluída");
        });

        test("STS-04: Encerrar conta Active com saldo zero", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 0 });
            const before = await getBalance(accountService, accountId);
            const startedAt = Date.now();

            const res = await accountService.PatchAccountStatus(accountId, { status: "Closed", reason: "Pedido do cliente" });

            expectChanged(res, accountId, { previousStatus: "Active", status: "Closed", reason: "Pedido do cliente" }, startedAt);
            expect(await getBalance(accountService, accountId)).toEqual({ ...before, status: "Closed", version: before.version + 1 });
        });

        test("STS-05: Encerrar conta Blocked com saldo zero", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 0, status: "Blocked" });
            const before = await getBalance(accountService, accountId);

            const res = await accountService.PatchAccountStatus(accountId, { status: "Closed", reason: "Encerramento judicial" });

            expectChanged(res, accountId, { previousStatus: "Blocked", status: "Closed", reason: "Encerramento judicial" }, Date.now() - 5_000);
            expect((await getBalance(accountService, accountId)).version).toBe(before.version + 1);
        });

        test("STS-06: Zerar o saldo com débito igual ao disponível e encerrar", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const accountId = await openAccountId(accountService, { initialDeposit: 12.34 });
            const destination = await openAccountId(accountService, { initialDeposit: 0 });

            await test.step("débito exatamente igual ao availableBalance é concluído", async () => {
                const transfer = await transferAndSettle(transferService, accountId, destination, 12.34);
                expect(transfer.status, transfer.failureReason ?? "").toBe("Completed");
                const balance = await getBalance(accountService, accountId);
                expect(balance.balance).toBeCloseTo(0, 2);
                expect(balance.availableBalance).toBeCloseTo(0, 2);
            });

            await test.step("conta zerada é encerrada", async () => {
                const res = await accountService.PatchAccountStatus(accountId, { status: "Closed", reason: "Pedido do cliente" });
                expect(res.status, res.text).toBe(200);
                expect(res.body.status).toBe("Closed");
            });
        });
    });

    test.describe("status igual ao atual", () => {
        test("STS-07: Active → Active responde changed false sem gravar", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const before = await getBalance(accountService, accountId);

            const res = await accountService.PatchAccountStatus(accountId, { status: "Active", reason: "Motivo qualquer" });

            expect(res.status, res.text).toBe(200);
            ContractValidator.validate(PatchAccountStatusResponseSchema, res.body);
            expect(res.body).toEqual({
                accountId,
                previousStatus: "Active",
                status: "Active",
                reason: null,
                changedAt: null,
                changed: false,
            });
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
            expect((await getAccount(accountService, accountId)).statusReason).toBeNull();
        });

        test("STS-08: Blocked → Blocked com outro reason não altera motivo, data nem version", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const blocked = await accountService.PatchAccountStatus(accountId, { status: "Blocked", reason: "Motivo original" });
            expect(blocked.status, blocked.text).toBe(200);
            const before = await getBalance(accountService, accountId);

            const res = await accountService.PatchAccountStatus(accountId, { status: "Blocked", reason: "Motivo diferente" });

            expect(res.status, res.text).toBe(200);
            ContractValidator.validate(PatchAccountStatusResponseSchema, res.body);
            expect(res.body).toEqual({
                accountId,
                previousStatus: "Blocked",
                status: "Blocked",
                reason: "Motivo original",
                changedAt: blocked.body.changedAt,
                changed: false,
            });
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
            expect((await getAccount(accountService, accountId)).statusReason).toBe("Motivo original");
        });
    });

    test.describe("validação do corpo", () => {
        test("STS-09: status ausente ou fora do enum", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const before = await getBalance(accountService, accountId);

            const invalid: { label: string; status?: unknown }[] = [
                { label: "ausente" },
                { label: "null", status: null },
                { label: "vazio", status: "" },
                { label: "minúsculo", status: "blocked" },
                { label: "maiúsculo", status: "CLOSED" },
                { label: "com espaço", status: " Blocked" },
                { label: "fora do enum", status: "Inactive" },
            ];
            for (const v of invalid) {
                await test.step(`400: ${v.label}`, async () => {
                    const body = invalidStatusBody(v.status === undefined ? { reason: "Motivo válido" } : { status: v.status, reason: "Motivo válido" });
                    expectProblem(await accountService.PatchAccountStatus(accountId, body), 400, DETAIL.status);
                });
            }
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });

        test("STS-10: Blocked ou Closed sem reason", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 0 });
            const before = await getBalance(accountService, accountId);

            for (const status of ["Blocked", "Closed"] as const) {
                for (const reason of [undefined, null, "", "     "]) {
                    await test.step(`400: ${status} com reason ${JSON.stringify(reason)}`, async () => {
                        const body = invalidStatusBody(reason === undefined ? { status } : { status, reason });
                        expectProblem(await accountService.PatchAccountStatus(accountId, body), 400, DETAIL.reasonRequired);
                    });
                }
            }
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });

        test("STS-11: reason fora de 5 a 200 caracteres", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const before = await getBalance(accountService, accountId);

            const invalid = [
                { status: "Blocked", reason: "abcd" },
                { status: "Blocked", reason: "   abcd   " },
                { status: "Blocked", reason: "a".repeat(201) },
                { status: "Active", reason: "abcd" },
            ] as const;
            for (const v of invalid) {
                await test.step(`400: ${v.status} com ${v.reason.length} caracteres enviados`, async () => {
                    expectProblem(await accountService.PatchAccountStatus(accountId, v), 400, DETAIL.reasonLength);
                });
            }
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));

            for (const reason of ["abcde", "a".repeat(200)]) {
                await test.step(`controle 200: ${reason.length} caracteres`, async () => {
                    const status = (await getBalance(accountService, accountId)).status === "Active" ? "Blocked" : "Active";
                    const res = await accountService.PatchAccountStatus(accountId, { status, reason });
                    expect(res.status, res.text).toBe(200);
                    expect(res.body).toMatchObject({ status, reason, changed: true });
                });
            }
        });

        test("STS-12: reason com espaços nas pontas é gravado sem eles", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);

            const res = await accountService.PatchAccountStatus(accountId, { status: "Blocked", reason: "   abcde   " });

            expect(res.status, res.text).toBe(200);
            expect(res.body.reason).toBe("abcde");
            expect((await getAccount(accountService, accountId)).statusReason).toBe("abcde");
        });

        test("STS-13: Conta inexistente", async ({ accountService }) => {
            const res = await accountService.PatchAccountStatus(randomUUID(), { status: "Blocked", reason: "Motivo válido" });

            expectProblem(res, 404, DETAIL.accountNotFound);
        });
    });

    test.describe("regras de negócio", () => {
        test("STS-14: Conta Closed não muda de status", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 0, status: "Closed" });
            const before = await getBalance(accountService, accountId);

            for (const status of ["Active", "Blocked", "Closed"] as const) {
                await test.step(`409: Closed → ${status}`, async () => {
                    const res = await accountService.PatchAccountStatus(accountId, { status, reason: "Tentativa de reabrir" });
                    expectProblem(res, 409, DETAIL.closed);
                });
            }
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
            expect((await getAccount(accountService, accountId)).statusReason).toBe("Preparação de teste");
        });

        test("STS-15: Encerrar conta com bloqueio de saldo ativo", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 0.01 });
            await createHold(accountService, accountId, { amount: 0.01 });
            const before = await getBalance(accountService, accountId);

            const res = await accountService.PatchAccountStatus(accountId, { status: "Closed", reason: "Pedido do cliente" });

            expectProblem(res, 422, DETAIL.activeHolds);
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });

        test("STS-16: Encerrar conta com saldo de 0,01", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 0.01 });
            const before = await getBalance(accountService, accountId);

            const res = await accountService.PatchAccountStatus(accountId, { status: "Closed", reason: "Pedido do cliente" });

            expectProblem(res, 422, DETAIL.nonZeroBalance);
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
            expect((await getAccount(accountService, accountId)).status).toBe("Active");
        });

        test("STS-17: Bloquear conta com saldo e bloqueio ativo é permitido", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 50 });
            await createHold(accountService, accountId, { amount: 20 });
            const before = await getBalance(accountService, accountId);

            const res = await accountService.PatchAccountStatus(accountId, { status: "Blocked", reason: "Ordem judicial" });

            expect(res.status, res.text).toBe(200);
            expect(await getBalance(accountService, accountId)).toEqual({ ...before, status: "Blocked", version: before.version + 1 });
        });

        test("STS-18: Ordem de avaliação das regras", async ({ accountService }) => {
            await test.step("conta inexistente + status inválido: 400 R1", async () => {
                expectProblem(await accountService.PatchAccountStatus(randomUUID(), invalidStatusBody({ status: "x" })), 400, DETAIL.status);
            });
            await test.step("conta inexistente + Blocked sem reason: 400 R2", async () => {
                expectProblem(await accountService.PatchAccountStatus(randomUUID(), { status: "Blocked" }), 400, DETAIL.reasonRequired);
            });
            await test.step("conta inexistente + reason curto: 400 R3", async () => {
                expectProblem(await accountService.PatchAccountStatus(randomUUID(), { status: "Active", reason: "abc" }), 400, DETAIL.reasonLength);
            });

            const closed = await openAccountId(accountService, { initialDeposit: 0, status: "Closed" });
            await test.step("conta Closed + Closed sem reason: 400 R2", async () => {
                expectProblem(await accountService.PatchAccountStatus(closed, { status: "Closed" }), 400, DETAIL.reasonRequired);
            });

            const withHoldAndBalance = await openAccountId(accountService, { initialDeposit: 1 });
            await createHold(accountService, withHoldAndBalance, { amount: 0.5 });
            await test.step("saldo + bloqueio ativo: 422 R6", async () => {
                const res = await accountService.PatchAccountStatus(withHoldAndBalance, { status: "Closed", reason: "Pedido do cliente" });
                expectProblem(res, 422, DETAIL.activeHolds);
            });
        });
    });

    test.describe("movimentação por status", () => {
        test("STS-19: Origem Blocked não é debitada", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const source = await openAccountId(accountService, { initialDeposit: 10, status: "Blocked" });
            const destination = await openAccountId(accountService, { initialDeposit: 0 });
            const before = await getBalance(accountService, source);

            const transfer = await transferAndSettle(transferService, source, destination, 1);

            expect(transfer.status).toBe("Failed");
            expect(transfer.failureReason).toBe(DETAIL.debitBlocked);
            expectBalanceUnchanged(before, await getBalance(accountService, source));
            expect((await getBalance(accountService, destination)).balance).toBe(0);
            expect((await getStatement(accountService, source)).totalItems).toBe(1);
        });

        test("STS-20: Destino Blocked é creditado", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const source = await openAccountId(accountService, { initialDeposit: 10 });
            const destination = await openAccountId(accountService, { initialDeposit: 5, status: "Blocked" });
            const before = await getBalance(accountService, destination);

            const transfer = await transferAndSettle(transferService, source, destination, 2.5);

            expect(transfer.status, transfer.failureReason ?? "").toBe("Completed");
            const after = await getBalance(accountService, destination);
            expect(after.status).toBe("Blocked");
            expect(after.balance).toBeCloseTo(cents(before.balance + 2.5), 2);
            expect(after.version).toBe(before.version + 1);
        });

        test("STS-21: Destino Closed recusa o crédito e a origem é estornada", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const source = await openAccountId(accountService, { initialDeposit: 10 });
            const destination = await openAccountId(accountService, { initialDeposit: 0, status: "Closed" });
            const destinationBefore = await getBalance(accountService, destination);

            const transfer = await transferAndSettle(transferService, source, destination, 3);

            expect(transfer.status).toBe("Refunded");
            expect(transfer.failureReason).toContain(DETAIL.movementClosed);
            expect((await getBalance(accountService, source)).balance).toBeCloseTo(10, 2);
            expectBalanceUnchanged(destinationBefore, await getBalance(accountService, destination));
            expect((await getStatement(accountService, destination)).totalItems).toBe(0);
        });

        test("STS-22: Origem Closed não é debitada", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const source = await openAccountId(accountService, { initialDeposit: 0, status: "Closed" });
            const destination = await openAccountId(accountService, { initialDeposit: 0 });

            const transfer = await transferAndSettle(transferService, source, destination, 0.01);

            expect(transfer.status).toBe("Failed");
            expect(transfer.failureReason).toBe(DETAIL.movementClosed);
            expect((await getBalance(accountService, destination)).balance).toBe(0);
        });

        test("STS-23: Mudanças de status não alteram saldo nem extrato", async ({ accountService }) => {
            const account = await openAccount(accountService, { initialDeposit: 20 });
            const statementBefore = await getStatement(accountService, account.accountId);
            const balanceBefore = await getBalance(accountService, account.accountId);

            for (const status of ["Blocked", "Active", "Blocked"] as const) {
                const res = await accountService.PatchAccountStatus(account.accountId, { status, reason: "Revisão periódica" });
                expect(res.status, res.text).toBe(200);
            }

            const balanceAfter = await getBalance(accountService, account.accountId);
            expect(balanceAfter).toEqual({ ...balanceBefore, status: "Blocked", version: balanceBefore.version + 3 });
            expect(await getStatement(accountService, account.accountId)).toEqual(statementBefore);
        });
    });
});
