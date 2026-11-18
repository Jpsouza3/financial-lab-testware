/**
 * Webhook do Antifraude (v1.0.0) — entregas anômalas do antifraude real até a Transfer API
 *
 * Regra: só a primeira decisão válida muda a transferência em Screening. `Duplicate` reenvia a mesma entrega
 * (mesmo deliveryId) e não gera segundo débito; `Flip` envia em seguida a decisão contrária com outro deliveryId,
 * e vale a primeira. O lado da Antifraud API registra as tentativas em `webhook.attempts` (GET /analyses).
 *
 * Também cobre a entrega do webhook (spec "Análises do Antifraude"): 404 encerra sem retry; falha de rede é
 * repetida até `Delivery:MaxAttempts` (5) com backoff exponencial a partir de `BaseBackoffMs` (200 ms).
 * Cada teste cria a própria regra, escopada pela conta de origem recém-aberta.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "../../fixtures/ApiFixtures";
import { openAccountId } from "../helpers/account/accounts";
import { cents, getBalance } from "../helpers/account/holds";
import { RuleScope } from "../helpers/e2e/rules";
import { createTransfer, getTransfer, secondsBetween, waitForTransferStatus, waitForWebhookDone, waitNoEffectWindow } from "../helpers/e2e/transfers";

const rules = new RuleScope();
const FLIP_REASON = "Decisão revista.";

test.describe("Entregas anômalas do webhook do antifraude", { tag: ["@e2e", "@spec:webhook-antifraude"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await rules.cleanup(antifraudService);
    });

    test("E2E-05: Duplicate Approved: a mesma entrega chega duas vezes e a origem é debitada uma vez", async ({ accountService, transferService, antifraudService }) => {
        const sourceAccountId = await openAccountId(accountService);
        const destinationAccountId = await openAccountId(accountService);
        await rules.create(antifraudService, sourceAccountId, { decision: "Approved", delivery: "Duplicate" });
        const sourceBefore = await getBalance(accountService, sourceAccountId);
        const destinationBefore = await getBalance(accountService, destinationAccountId);

        const transfer = await createTransfer(transferService, sourceAccountId, destinationAccountId, 10);

        await test.step("duas tentativas com o mesmo deliveryId, ambas 200", async () => {
            const analysis = await waitForWebhookDone(antifraudService, transfer.endToEndId);
            expect(analysis.webhook).toMatchObject({ mode: "Duplicate", status: "Delivered" });
            const attempts = analysis.webhook.attempts;
            expect(attempts.map((a) => [a.decision, a.statusCode])).toEqual([["Approved", 200], ["Approved", 200]]);
            expect(attempts[1].deliveryId).toBe(attempts[0].deliveryId);
        });

        const done = await waitForTransferStatus(transferService, transfer.id, "Completed");

        await test.step("um único débito e um único crédito", async () => {
            await waitNoEffectWindow();
            const sourceAfter = await getBalance(accountService, sourceAccountId);
            const destinationAfter = await getBalance(accountService, destinationAccountId);
            expect(sourceAfter.balance).toBeCloseTo(cents(sourceBefore.balance - 10), 2);
            expect(sourceAfter.version).toBe(sourceBefore.version + 1);
            expect(destinationAfter.balance).toBeCloseTo(cents(destinationBefore.balance + 10), 2);
            expect(destinationAfter.version).toBe(destinationBefore.version + 1);
            expect(await getTransfer(transferService, transfer.id)).toEqual(done);
        });
    });

    test("E2E-06: Duplicate Rejected: a segunda entrega não muda a recusa", async ({ accountService, transferService, antifraudService }) => {
        const sourceAccountId = await openAccountId(accountService);
        const destinationAccountId = await openAccountId(accountService);
        const reason = "Duplicada e recusada (teste).";
        await rules.create(antifraudService, sourceAccountId, { decision: "Rejected", reason, delivery: "Duplicate" });
        const sourceBefore = await getBalance(accountService, sourceAccountId);

        const transfer = await createTransfer(transferService, sourceAccountId, destinationAccountId, 10);

        const analysis = await waitForWebhookDone(antifraudService, transfer.endToEndId);
        const attempts = analysis.webhook.attempts;
        expect(attempts.map((a) => [a.decision, a.statusCode])).toEqual([["Rejected", 200], ["Rejected", 200]]);
        expect(attempts[1].deliveryId).toBe(attempts[0].deliveryId);

        const rejected = await getTransfer(transferService, transfer.id);
        expect(rejected).toMatchObject({ status: "FraudRejected", failureReason: reason, debit: null });
        expect(await getBalance(accountService, sourceAccountId)).toEqual(sourceBefore);
    });

    test("E2E-07: Flip Approved → Rejected: vale a aprovação e a transferência termina Completed", async ({ accountService, transferService, antifraudService }) => {
        const sourceAccountId = await openAccountId(accountService);
        const destinationAccountId = await openAccountId(accountService);
        await rules.create(antifraudService, sourceAccountId, { decision: "Approved", delivery: "Flip" });
        const sourceBefore = await getBalance(accountService, sourceAccountId);

        const transfer = await createTransfer(transferService, sourceAccountId, destinationAccountId, 10);

        await test.step("duas entregas: Approved e depois Rejected, com deliveryIds diferentes", async () => {
            const analysis = await waitForWebhookDone(antifraudService, transfer.endToEndId);
            expect(analysis.status).toBe("Approved");
            const attempts = analysis.webhook.attempts;
            expect(attempts.map((a) => [a.decision, a.statusCode])).toEqual([["Approved", 200], ["Rejected", 200]]);
            expect(attempts[1].deliveryId).not.toBe(attempts[0].deliveryId);
        });

        const done = await waitForTransferStatus(transferService, transfer.id, "Completed");
        expect(done).toMatchObject({ failureReason: null, refund: null });
        expect((await getBalance(accountService, sourceAccountId)).balance).toBeCloseTo(cents(sourceBefore.balance - 10), 2);
    });

    test("E2E-08: Flip Rejected → Approved: vale a recusa e nada é debitado", async ({ accountService, transferService, antifraudService }) => {
        const sourceAccountId = await openAccountId(accountService);
        const destinationAccountId = await openAccountId(accountService);
        const reason = "Primeira decisão do Flip (teste).";
        await rules.create(antifraudService, sourceAccountId, { decision: "Rejected", reason, delivery: "Flip" });
        const sourceBefore = await getBalance(accountService, sourceAccountId);
        const destinationBefore = await getBalance(accountService, destinationAccountId);

        const transfer = await createTransfer(transferService, sourceAccountId, destinationAccountId, 10);

        const analysis = await waitForWebhookDone(antifraudService, transfer.endToEndId);
        const attempts = analysis.webhook.attempts;
        expect(attempts.map((a) => [a.decision, a.statusCode])).toEqual([["Rejected", 200], ["Approved", 200]]);
        expect(attempts[1].deliveryId).not.toBe(attempts[0].deliveryId);

        await waitNoEffectWindow();
        const rejected = await getTransfer(transferService, transfer.id);
        expect(rejected).toMatchObject({ status: "FraudRejected", failureReason: reason, debit: null, credit: null });
        expect(rejected.failureReason).not.toBe(FLIP_REASON);
        expect(await getBalance(accountService, sourceAccountId)).toEqual(sourceBefore);
        expect(await getBalance(accountService, destinationAccountId)).toEqual(destinationBefore);
    });
});

test.describe("Entrega do webhook pela Antifraud API", { tag: ["@e2e", "@spec:analises-antifraude"] }, () => {
    const analysisFor = (callbackUrl: string) => ({
        transactionId: `e2e-${randomUUID()}`,
        amount: 1,
        sourceAccountId: randomUUID(),
        destinationAccountId: randomUUID(),
        description: "Entrega do webhook (teste)",
        callbackUrl,
    });

    test("E2E-09: Transfer API responde 404 para transação desconhecida e a entrega termina sem retry", async ({ antifraudService }) => {
        const body = analysisFor("http://transfer-api:8080/webhooks/antifraud");
        const res = await antifraudService.PostAnalysis(body);
        expect(res.status, res.text).toBe(202);

        const analysis = await waitForWebhookDone(antifraudService, body.transactionId);
        expect(analysis.status).toBe("Approved");
        expect(analysis.webhook.status).toBe("Failed");
        expect(analysis.webhook.attempts).toHaveLength(1);
        expect(analysis.webhook.attempts[0]).toMatchObject({ attempt: 1, decision: "Approved", statusCode: 404, error: null });
    });

    test("E2E-10: Falha de rede é repetida 5 vezes com backoff exponencial e a entrega termina Failed", async ({ antifraudService }) => {
        const body = analysisFor("http://localhost:1/webhooks/antifraud");
        const res = await antifraudService.PostAnalysis(body);
        expect(res.status, res.text).toBe(202);

        const analysis = await waitForWebhookDone(antifraudService, body.transactionId, 20_000);
        expect(analysis.webhook.status).toBe("Failed");
        const attempts = analysis.webhook.attempts;
        expect(attempts.map((a) => a.attempt)).toEqual([1, 2, 3, 4, 5]);
        for (const a of attempts) {
            expect(a).toMatchObject({ decision: "Approved", statusCode: null, deliveryId: attempts[0].deliveryId });
            expect(a.error).not.toBeNull();
        }

        await test.step("intervalos de ~200, 400, 800 e 1600 ms entre as tentativas", async () => {
            const gaps = attempts.slice(1).map((a, i) => secondsBetween(attempts[i].at, a.at) * 1000);
            const expected = [200, 400, 800, 1600];
            gaps.forEach((gap, i) => {
                expect(gap, `intervalo ${i + 1}`).toBeGreaterThanOrEqual(expected[i] * 0.9);
                expect(gap, `intervalo ${i + 1}`).toBeLessThan(expected[i] + 1_000);
            });
        });
    });
});
