/**
 * Análises do Antifraude (v1.0.0) — entrega do webhook (observada em GET /analyses/{id}.webhook)
 *
 * Regra: depois da decisão, o webhook é enviado ao callbackUrl no modo `delivery` da regra (Normal se nenhuma casou).
 * E1 Normal: uma entrega (Delivered com 2xx, senão Failed). E2 Duplicate: segunda entrega com o mesmo deliveryId.
 * E3 Drop: Skipped, sem tentativas. E4 InvalidSignature: Transfer API responde 401, sem retry. E5 Flip: segunda
 * entrega com a decisão oposta e novo deliveryId; o status da análise não muda. Retry em erro de rede/timeout/408/409/
 * 425/429/5xx, até 5 tentativas, com espera de 200 ms × 2^(tentativa−1); outro não 2xx encerra a entrega.
 *
 * Callbacks: `http://transfer-api:8080/webhooks/antifraud` com transactionId desconhecido → 404 (encerra a entrega);
 * `http://localhost:9/webhook` → conexão recusada dentro do container do antifraude (retry).
 * Fora do escopo: corpo e headers do webhook (o callback não é controlado pelo teste; ver specs de transfer).
 */
import { randomUUID } from "node:crypto";
import { DeliveryAttempt } from "../../domains/antifraud/DeliveryAttempt";
import { expect, test } from "../../fixtures/ApiFixtures";
import { openAccountId } from "../helpers/account/accounts";
import { waitForTransferFinal } from "../helpers/account/holds";
import {
    CALLBACK,
    submitAnalysis,
    waitForAnalysisOfTransaction,
    waitForDecision,
    waitForWebhookDone,
} from "../helpers/antifraud/analyses";
import { createRule, deleteCreatedRules } from "../helpers/antifraud/rules";

function gapsMs(attempts: DeliveryAttempt[]): number[] {
    return attempts.slice(1).map((a, i) => Date.parse(a.at) - Date.parse(attempts[i].at));
}

test.describe("Webhook da análise", { tag: ["@antifraud", "@spec:analises-antifraude"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await deleteCreatedRules(antifraudService);
    });

    test.describe("Normal", () => {
        test("ANL-24: Callback com resposta 2xx deixa o webhook Delivered com uma tentativa", async ({ accountService, transferService, antifraudService }) => {
            test.setTimeout(90_000);
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService);

            const res = await transferService.PostTransfer({ sourceAccountId: source, destinationAccountId: destination, amount: 1 });
            expect(res.status, res.text).toBe(202);
            await waitForTransferFinal(transferService, res.body.id);

            const analysis = await waitForAnalysisOfTransaction(antifraudService, res.body.endToEndId);
            expect(analysis).toMatchObject({ status: "Approved", ruleId: null, amount: 1, sourceAccountId: source, destinationAccountId: destination });
            expect(analysis.webhook).toMatchObject({ mode: "Normal", status: "Delivered" });
            expect(analysis.webhook.attempts).toHaveLength(1);
            expect(analysis.webhook.attempts[0]).toMatchObject({ attempt: 1, decision: "Approved", error: null });
            expect(analysis.webhook.attempts[0].statusCode).toBeGreaterThanOrEqual(200);
            expect(analysis.webhook.attempts[0].statusCode).toBeLessThan(300);
        });

        test("ANL-25: Resposta 404 encerra a entrega na primeira tentativa e deixa o webhook Failed", async ({ antifraudService }) => {
            const submitted = await submitAnalysis(antifraudService, { callbackUrl: CALLBACK.transferUnknown });

            const done = await waitForWebhookDone(antifraudService, submitted.id);

            expect(done.webhook.mode).toBe("Normal");
            expect(done.webhook.status).toBe("Failed");
            expect(done.webhook.attempts).toHaveLength(1);
            expect(done.webhook.attempts[0]).toMatchObject({ attempt: 1, decision: "Approved", statusCode: 404, error: null });
            expect(Date.parse(done.webhook.attempts[0].at)).toBeGreaterThanOrEqual(Date.parse(done.decidedAt!));
        });

        test("ANL-26: Erro de rede é repetido até 5 tentativas na mesma entrega, com espera exponencial", async ({ antifraudService }) => {
            test.setTimeout(60_000);
            const submitted = await submitAnalysis(antifraudService, { callbackUrl: CALLBACK.unreachable });

            const done = await waitForWebhookDone(antifraudService, submitted.id, 5, 30_000);
            const attempts = done.webhook.attempts;

            await test.step("5 tentativas da mesma entrega, todas com erro de rede", async () => {
                expect(done.webhook.status).toBe("Failed");
                expect(attempts.map((a) => a.attempt)).toEqual([1, 2, 3, 4, 5]);
                expect(new Set(attempts.map((a) => a.deliveryId)).size).toBe(1);
                for (const a of attempts) {
                    expect(a.statusCode).toBeNull();
                    expect(a.error).toEqual(expect.any(String));
                    expect(a.decision).toBe("Approved");
                }
            });

            await test.step("espera de ~200, 400, 800 e 1600 ms entre as tentativas", async () => {
                const gaps = gapsMs(attempts);
                const expected = [200, 400, 800, 1_600];
                gaps.forEach((gap, i) => {
                    expect(gap, `espera antes da tentativa ${i + 2}`).toBeGreaterThanOrEqual(expected[i] - 20);
                    expect(gap, `espera antes da tentativa ${i + 2}`).toBeLessThan(expected[i] + 1_000);
                });
                expect(gaps[3]).toBeGreaterThan(gaps[0] * 4);
            });
        });
    });

    test.describe("modos de entrega", () => {
        test("ANL-27: Duplicate envia uma segunda entrega com o mesmo deliveryId e a mesma decisão", async ({ antifraudService }) => {
            const source = randomUUID();
            const rule = await createRule(antifraudService, { sourceAccountIds: [source], delivery: "Duplicate" });
            const submitted = await submitAnalysis(antifraudService, { sourceAccountId: source, callbackUrl: CALLBACK.transferUnknown });
            expect(submitted.webhook.mode).toBe("Duplicate");

            const done = await waitForWebhookDone(antifraudService, submitted.id, 2);

            expect(done).toMatchObject({ status: "Rejected", ruleId: rule.id });
            expect(done.webhook).toMatchObject({ mode: "Duplicate", status: "Failed" });
            const [first, second] = done.webhook.attempts;
            expect(done.webhook.attempts).toHaveLength(2);
            expect(second.deliveryId).toBe(first.deliveryId);
            for (const a of [first, second]) expect(a).toMatchObject({ attempt: 1, decision: "Rejected", statusCode: 404 });
            expect(Date.parse(second.at)).toBeGreaterThanOrEqual(Date.parse(first.at));
        });

        test("ANL-28: Drop não chama o callback e deixa o webhook Skipped", async ({ antifraudService }) => {
            const source = randomUUID();
            const rule = await createRule(antifraudService, { sourceAccountIds: [source], decision: "Approved", delivery: "Drop" });
            const submitted = await submitAnalysis(antifraudService, { sourceAccountId: source, callbackUrl: CALLBACK.transferUnknown });

            const decided = await waitForDecision(antifraudService, submitted.id);
            const done = await waitForWebhookDone(antifraudService, submitted.id);

            expect(decided).toMatchObject({ status: "Approved", ruleId: rule.id });
            expect(done.webhook).toEqual({ mode: "Drop", status: "Skipped", attempts: [] });
        });

        test("ANL-29: InvalidSignature é recusado pela Transfer API com 401, sem retry", async ({ antifraudService }) => {
            const source = randomUUID();
            await createRule(antifraudService, { sourceAccountIds: [source], delivery: "InvalidSignature" });
            const submitted = await submitAnalysis(antifraudService, { sourceAccountId: source, callbackUrl: CALLBACK.transferUnknown });

            const done = await waitForWebhookDone(antifraudService, submitted.id);

            expect(done.webhook).toMatchObject({ mode: "InvalidSignature", status: "Failed" });
            expect(done.webhook.attempts).toHaveLength(1);
            expect(done.webhook.attempts[0]).toMatchObject({ attempt: 1, decision: "Rejected", statusCode: 401, error: null });
        });

        test("ANL-30: Flip envia outra entrega com a decisão oposta e novo deliveryId, sem mudar o status", async ({ antifraudService }) => {
            const approvedSource = randomUUID();
            const rejectedSource = randomUUID();
            const approvedRule = await createRule(antifraudService, { sourceAccountIds: [approvedSource], decision: "Approved", delivery: "Flip" });
            const rejectedRule = await createRule(antifraudService, { sourceAccountIds: [rejectedSource], delivery: "Flip" });

            const cases = [
                { label: "Approved", source: approvedSource, rule: approvedRule.id, first: "Approved", flipped: "Rejected" },
                { label: "Rejected", source: rejectedSource, rule: rejectedRule.id, first: "Rejected", flipped: "Approved" },
            ] as const;
            const submitted = await Promise.all(
                cases.map((c) => submitAnalysis(antifraudService, { sourceAccountId: c.source, callbackUrl: CALLBACK.transferUnknown }))
            );
            const done = await Promise.all(submitted.map((s) => waitForWebhookDone(antifraudService, s.id, 2)));

            cases.forEach((c, i) => {
                const analysis = done[i];
                expect(analysis, c.label).toMatchObject({ status: c.first, ruleId: c.rule });
                expect(analysis.webhook, c.label).toMatchObject({ mode: "Flip", status: "Failed" });
                expect(analysis.webhook.attempts, c.label).toHaveLength(2);
                const [first, second] = analysis.webhook.attempts;
                expect(first, c.label).toMatchObject({ attempt: 1, decision: c.first, statusCode: 404 });
                expect(second, c.label).toMatchObject({ attempt: 1, decision: c.flipped, statusCode: 404 });
                expect(second.deliveryId, c.label).not.toBe(first.deliveryId);
            });
        });
    });
});
