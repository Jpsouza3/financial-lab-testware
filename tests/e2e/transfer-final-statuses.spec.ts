/**
 * Criar Transferência (v1.0.0) — fluxo assíncrono ponta a ponta: Transfer API → Antifraud API (webhook) → Account API
 *
 * Regra: POST /transfers responde 202 em Screening; o antifraude decide e entrega o webhook assinado; aprovada,
 * a transferência debita a origem e credita o destino (Completed); recusada fica FraudRejected; débito recusado
 * termina Failed sem movimentar nada; crédito recusado gera refundEndToEndId (D...), devolve o valor à origem e
 * termina Refunded.
 *
 * Cada teste abre as próprias contas. Fora do escopo (v1.0.0): RefundFailed (P10), que exige encerrar a origem
 * entre o débito e a devolução, sem ponto de controle pela API; extrato (sem método na AccountInterface).
 */
import { expect, test } from "../../fixtures/ApiFixtures";
import { openAccountId } from "../helpers/account/accounts";
import { cents, getBalance } from "../helpers/account/holds";
import { RuleScope } from "../helpers/e2e/rules";
import { createTransfer, getTransfer, REASON, waitForTransferStatus, waitForWebhookDone, waitNoEffectWindow } from "../helpers/e2e/transfers";

const rules = new RuleScope();
const END_TO_END = /^E99999999\d{12}[A-Za-z0-9]{11}$/;
const REFUND_END_TO_END = /^D99999999\d{12}[A-Za-z0-9]{11}$/;

test.describe("Transferência ponta a ponta: status finais", { tag: ["@e2e", "@spec:criar-transferencia"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await rules.cleanup(antifraudService);
    });

    test("E2E-01: Aprovada pelo antifraude padrão termina Completed com débito e crédito", async ({ accountService, transferService, antifraudService }) => {
        const sourceAccountId = await openAccountId(accountService, { initialDeposit: 100 });
        const destinationAccountId = await openAccountId(accountService, { initialDeposit: 20 });
        const sourceBefore = await getBalance(accountService, sourceAccountId);
        const destinationBefore = await getBalance(accountService, destinationAccountId);

        const transfer = await createTransfer(transferService, sourceAccountId, destinationAccountId, 12.34);
        expect(transfer.endToEndId).toMatch(END_TO_END);

        await test.step("antifraude aprova e entrega o webhook uma vez com 200", async () => {
            const analysis = await waitForWebhookDone(antifraudService, transfer.endToEndId);
            expect(analysis).toMatchObject({ status: "Approved", amount: 12.34, sourceAccountId, destinationAccountId });
            expect(analysis.webhook.status).toBe("Delivered");
            expect(analysis.webhook.attempts.map((a) => [a.decision, a.statusCode])).toEqual([["Approved", 200]]);
        });

        const done = await test.step("Completed com as duas pernas", async () => {
            const t = await waitForTransferStatus(transferService, transfer.id, "Completed");
            expect(t).toMatchObject({ failureReason: null, refundEndToEndId: null, refund: null, amount: 12.34 });
            expect(t.debit).toMatchObject({ accountId: sourceAccountId, endToEndId: transfer.endToEndId });
            expect(t.credit).toMatchObject({ accountId: destinationAccountId, endToEndId: transfer.endToEndId });
            expect(t.debit!.entryId).not.toBe(t.credit!.entryId);
            return t;
        });

        await test.step("saldos e version", async () => {
            const sourceAfter = await getBalance(accountService, sourceAccountId);
            const destinationAfter = await getBalance(accountService, destinationAccountId);
            expect(sourceAfter.balance).toBeCloseTo(cents(sourceBefore.balance - 12.34), 2);
            expect(sourceAfter.version).toBe(sourceBefore.version + 1);
            expect(destinationAfter.balance).toBeCloseTo(cents(destinationBefore.balance + 12.34), 2);
            expect(destinationAfter.version).toBe(destinationBefore.version + 1);
        });

        expect(Date.parse(done.updatedAt)).toBeGreaterThan(Date.parse(done.createdAt));
    });

    test("E2E-02: Recusada por regra termina FraudRejected com o motivo da regra e sem movimentação", async ({ accountService, transferService, antifraudService }) => {
        const sourceAccountId = await openAccountId(accountService);
        const destinationAccountId = await openAccountId(accountService);
        const reason = "Regra de teste e2e: recusa.";
        await rules.create(antifraudService, sourceAccountId, { decision: "Rejected", reason });
        const sourceBefore = await getBalance(accountService, sourceAccountId);
        const destinationBefore = await getBalance(accountService, destinationAccountId);

        const transfer = await createTransfer(transferService, sourceAccountId, destinationAccountId, 10);

        const rejected = await waitForTransferStatus(transferService, transfer.id, "FraudRejected");
        expect(rejected).toMatchObject({ failureReason: reason, debit: null, credit: null, refund: null });
        const analysis = await waitForWebhookDone(antifraudService, transfer.endToEndId);
        expect(analysis.webhook.attempts.map((a) => [a.decision, a.statusCode])).toEqual([["Rejected", 200]]);

        await waitNoEffectWindow();
        expect(await getBalance(accountService, sourceAccountId)).toEqual(sourceBefore);
        expect(await getBalance(accountService, destinationAccountId)).toEqual(destinationBefore);
    });

    test("E2E-03: Débito recusado termina Failed sem movimentar nenhuma conta", async ({ accountService, transferService }) => {
        const variations = [
            { label: "origem Blocked", source: { status: "Blocked" as const }, amount: 10, reason: REASON.blocked },
            { label: "saldo insuficiente", source: { initialDeposit: 5 }, amount: 5.01, reason: REASON.insufficient },
        ];
        for (const v of variations) {
            await test.step(v.label, async () => {
                const sourceAccountId = await openAccountId(accountService, v.source);
                const destinationAccountId = await openAccountId(accountService);
                const sourceBefore = await getBalance(accountService, sourceAccountId);
                const destinationBefore = await getBalance(accountService, destinationAccountId);

                const transfer = await createTransfer(transferService, sourceAccountId, destinationAccountId, v.amount);
                const failed = await waitForTransferStatus(transferService, transfer.id, "Failed");
                expect(failed).toMatchObject({ failureReason: v.reason, debit: null, credit: null, refund: null, refundEndToEndId: null });

                await waitNoEffectWindow();
                expect(await getBalance(accountService, sourceAccountId)).toEqual(sourceBefore);
                expect(await getBalance(accountService, destinationAccountId)).toEqual(destinationBefore);
                expect((await getTransfer(transferService, transfer.id)).status).toBe("Failed");
            });
        }
    });

    test("E2E-04: Crédito recusado (destino Closed) estorna para a origem e termina Refunded", async ({ accountService, transferService }) => {
        const sourceAccountId = await openAccountId(accountService, { initialDeposit: 100 });
        const destinationAccountId = await openAccountId(accountService, { initialDeposit: 0, status: "Closed" });
        const sourceBefore = await getBalance(accountService, sourceAccountId);
        const destinationBefore = await getBalance(accountService, destinationAccountId);

        const transfer = await createTransfer(transferService, sourceAccountId, destinationAccountId, 25);

        const refunded = await test.step("Refunded com débito e devolução, sem crédito", async () => {
            const t = await waitForTransferStatus(transferService, transfer.id, "Refunded");
            expect(t.failureReason).toBe(REASON.closed);
            expect(t.refundEndToEndId).toMatch(REFUND_END_TO_END);
            expect(t.refundEndToEndId).not.toBe(t.endToEndId);
            expect(t.debit).toMatchObject({ accountId: sourceAccountId, endToEndId: transfer.endToEndId });
            expect(t.credit).toBeNull();
            expect(t.refund).toMatchObject({ accountId: sourceAccountId, endToEndId: t.refundEndToEndId });
            expect(t.refund!.entryId).not.toBe(t.debit!.entryId);
            return t;
        });

        await test.step("saldo da origem restaurado; destino sem lançamento", async () => {
            await waitNoEffectWindow();
            const sourceAfter = await getBalance(accountService, sourceAccountId);
            expect(sourceAfter.balance).toBeCloseTo(sourceBefore.balance, 2);
            expect(sourceAfter.availableBalance).toBeCloseTo(sourceBefore.availableBalance, 2);
            expect(sourceAfter.version).toBe(sourceBefore.version + 2);
            expect(await getBalance(accountService, destinationAccountId)).toEqual(destinationBefore);
            expect(await getTransfer(transferService, transfer.id)).toEqual(refunded);
        });
    });
});
