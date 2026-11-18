/**
 * Reconciliação do Antifraude (v1.0.0) — processo interno da Transfer API, observado em GET /transfers/{transferId}
 *
 * Regra: a cada 5 s, transferências em Screening criadas há mais de 10 s consultam a análise
 * (GET /analyses?transactionId). Approved → segue até Completed; Rejected → FraudRejected com o reason da análise;
 * sem decisão aos 60 s → FraudRejected "O antifraude não respondeu a tempo."; análise inexistente → reenvio para
 * análise. Webhook que chega depois disso é ignorado.
 *
 * O comportamento do antifraude vem de uma regra própria por teste (`delivery`, `delayMs`, `submitFailures`),
 * escopada pela conta de origem recém-aberta e removida no afterEach.
 * Fora do escopo (v1.0.0): R5 (antifraude fora do ar), R6 por `DELETE /analyses` (estado global), limite de 100
 * por execução (`ReconcileBatchSize`) e prioridade da decisão sobre o timeout depois dos 60 s, que exigem parar
 * serviços ou estado global.
 */
import { expect, test } from "../../fixtures/ApiFixtures";
import { AccountInterface } from "../../interfaces/AccountInterface";
import { AntifraudInterface } from "../../interfaces/AntifraudInterface";
import { openAccountId } from "../helpers/account/accounts";
import { cents, getBalance } from "../helpers/account/holds";
import { RuleScope, ScopedRule } from "../helpers/e2e/rules";
import {
    createTransfer,
    expectTransferUnchanged,
    findAnalysis,
    getTransfer,
    REASON,
    secondsBetween,
    waitForTransferStatus,
    waitForWebhookDone,
    waitNoEffectWindow,
} from "../helpers/e2e/transfers";

const rules = new RuleScope();

/** `Antifraud:StaleAfterSeconds`: antes disso só o webhook decide. */
const STALE_AFTER_S = 10;
/** Folga para o intervalo de 5 s, o processamento e as mensagens entre as APIs. */
const RECONCILE_LATEST_S = 30;
/** `Antifraud:TimeoutSeconds`. */
const TIMEOUT_S = 60;

test.describe("Reconciliação do antifraude", { tag: ["@transfer", "@spec:reconciliacao-antifraude"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await rules.cleanup(antifraudService);
    });

    async function setup(
        { accountService, antifraudService }: { accountService: AccountInterface, antifraudService: AntifraudInterface },
        rule: ScopedRule
    ) {
        const sourceAccountId = await openAccountId(accountService);
        const destinationAccountId = await openAccountId(accountService);
        const created = await rules.create(antifraudService, sourceAccountId, rule);
        return {
            sourceAccountId,
            destinationAccountId,
            rule: created,
            sourceBefore: await getBalance(accountService, sourceAccountId),
            destinationBefore: await getBalance(accountService, destinationAccountId),
        };
    }

    test.describe("webhook descartado (Drop)", () => {
        test("REC-01: Análise Approved com webhook descartado chega a Completed pela reconciliação", async ({ accountService, transferService, antifraudService }) => {
            test.setTimeout(60_000);
            const ctx = await setup({ accountService, antifraudService }, { decision: "Approved", delivery: "Drop" });
            const transfer = await createTransfer(transferService, ctx.sourceAccountId, ctx.destinationAccountId, 10);

            await test.step("antifraude decide Approved e não entrega o webhook", async () => {
                const analysis = await waitForWebhookDone(antifraudService, transfer.endToEndId);
                expect(analysis).toMatchObject({ status: "Approved", ruleId: ctx.rule.id });
                expect(analysis.webhook).toEqual({ mode: "Drop", status: "Skipped", attempts: [] });
            });

            const done = await test.step("reconciliação aplica a decisão depois de 10 s", async () => {
                const completed = await waitForTransferStatus(transferService, transfer.id, "Completed", 45_000);
                const elapsed = secondsBetween(transfer.createdAt, completed.debit!.occurredAt);
                expect(elapsed).toBeGreaterThanOrEqual(STALE_AFTER_S);
                expect(elapsed).toBeLessThanOrEqual(RECONCILE_LATEST_S);
                return completed;
            });

            expect(done).toMatchObject({ failureReason: null, refund: null });
            expect(done.credit).toMatchObject({ accountId: ctx.destinationAccountId, endToEndId: transfer.endToEndId });
            expect((await getBalance(accountService, ctx.sourceAccountId)).balance).toBeCloseTo(cents(ctx.sourceBefore.balance - 10), 2);
            expect((await getBalance(accountService, ctx.destinationAccountId)).balance).toBeCloseTo(cents(ctx.destinationBefore.balance + 10), 2);
        });

        test("REC-02: Análise Rejected com webhook descartado fica FraudRejected com o reason da análise", async ({ accountService, transferService, antifraudService }) => {
            test.setTimeout(60_000);
            const reason = "Recusa por reconciliação (teste).";
            const ctx = await setup({ accountService, antifraudService }, { decision: "Rejected", reason, delivery: "Drop" });
            const transfer = await createTransfer(transferService, ctx.sourceAccountId, ctx.destinationAccountId, 10);

            const rejected = await waitForTransferStatus(transferService, transfer.id, "FraudRejected", 45_000);
            expect(rejected).toMatchObject({ failureReason: reason, debit: null, credit: null, refund: null });
            const elapsed = secondsBetween(transfer.createdAt, rejected.updatedAt);
            expect(elapsed).toBeGreaterThanOrEqual(STALE_AFTER_S);
            expect(elapsed).toBeLessThanOrEqual(RECONCILE_LATEST_S);

            await waitNoEffectWindow();
            expect(await getBalance(accountService, ctx.sourceAccountId)).toEqual(ctx.sourceBefore);
            expect(await getBalance(accountService, ctx.destinationAccountId)).toEqual(ctx.destinationBefore);
        });
    });

    test.describe("webhook com assinatura inválida (InvalidSignature)", () => {
        test("REC-03: Transfer API recusa o webhook com 401, não muda a transferência e a reconciliação aprova", async ({ accountService, transferService, antifraudService }) => {
            test.setTimeout(60_000);
            const ctx = await setup({ accountService, antifraudService }, { decision: "Approved", delivery: "InvalidSignature" });
            const transfer = await createTransfer(transferService, ctx.sourceAccountId, ctx.destinationAccountId, 10);

            await test.step("uma única tentativa, recusada com 401 e sem retry", async () => {
                const analysis = await waitForWebhookDone(antifraudService, transfer.endToEndId);
                expect(analysis.status).toBe("Approved");
                expect(analysis.webhook.status).toBe("Failed");
                expect(analysis.webhook.attempts).toHaveLength(1);
                expect(analysis.webhook.attempts[0]).toMatchObject({ attempt: 1, decision: "Approved", statusCode: 401 });
            });

            await test.step("transferência continua em Screening logo depois do 401", async () => {
                const now = await getTransfer(transferService, transfer.id);
                expect(secondsBetween(transfer.createdAt, new Date().toISOString())).toBeLessThan(STALE_AFTER_S);
                expectTransferUnchanged(transfer, now);
            });

            await test.step("reconciliação aplica a aprovação depois de 10 s", async () => {
                const completed = await waitForTransferStatus(transferService, transfer.id, "Completed", 45_000);
                const elapsed = secondsBetween(transfer.createdAt, completed.debit!.occurredAt);
                expect(elapsed).toBeGreaterThanOrEqual(STALE_AFTER_S);
                expect(elapsed).toBeLessThanOrEqual(RECONCILE_LATEST_S);
                expect((await getBalance(accountService, ctx.sourceAccountId)).balance).toBeCloseTo(cents(ctx.sourceBefore.balance - 10), 2);
            });
        });

        test("REC-04: Webhook Rejected com assinatura inválida vira FraudRejected pela reconciliação", async ({ accountService, transferService, antifraudService }) => {
            test.setTimeout(60_000);
            const reason = "Recusa com assinatura forjada (teste).";
            const ctx = await setup({ accountService, antifraudService }, { decision: "Rejected", reason, delivery: "InvalidSignature" });
            const transfer = await createTransfer(transferService, ctx.sourceAccountId, ctx.destinationAccountId, 10);

            const analysis = await waitForWebhookDone(antifraudService, transfer.endToEndId);
            expect(analysis.webhook.attempts.map((a) => a.statusCode)).toEqual([401]);

            const rejected = await waitForTransferStatus(transferService, transfer.id, "FraudRejected", 45_000);
            expect(rejected.failureReason).toBe(reason);
            expect(secondsBetween(transfer.createdAt, rejected.updatedAt)).toBeGreaterThanOrEqual(STALE_AFTER_S);
            expect(await getBalance(accountService, ctx.sourceAccountId)).toEqual(ctx.sourceBefore);
        });
    });

    test.describe("timeout fail-closed", () => {
        test("REC-05: Análise ainda Pending aos 60 s leva a FraudRejected e o webhook atrasado é ignorado", async ({ accountService, transferService, antifraudService }) => {
            test.setTimeout(150_000);
            const delayMs = 90_000;
            const ctx = await setup({ accountService, antifraudService }, { decision: "Approved", delayMs });
            const transfer = await createTransfer(transferService, ctx.sourceAccountId, ctx.destinationAccountId, 10);

            const rejected = await test.step("FraudRejected por timeout entre ~60 e ~65 s", async () => {
                const t = await waitForTransferStatus(transferService, transfer.id, "FraudRejected", 90_000);
                expect(t).toMatchObject({ failureReason: REASON.screeningTimeout, debit: null, credit: null, refund: null });
                const elapsed = secondsBetween(transfer.createdAt, t.updatedAt);
                expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_S);
                expect(elapsed).toBeLessThanOrEqual(TIMEOUT_S + 20);
                return t;
            });

            await test.step("webhook Approved aos 90 s é aceito com 200 e não muda nada", async () => {
                const analysis = await waitForWebhookDone(antifraudService, transfer.endToEndId, 60_000);
                expect(analysis.status).toBe("Approved");
                expect(analysis.webhook).toMatchObject({ mode: "Normal", status: "Delivered" });
                expect(analysis.webhook.attempts.map((a) => a.statusCode)).toEqual([200]);

                await waitNoEffectWindow();
                expectTransferUnchanged(rejected, await getTransfer(transferService, transfer.id));
                expect(await getBalance(accountService, ctx.sourceAccountId)).toEqual(ctx.sourceBefore);
                expect(await getBalance(accountService, ctx.destinationAccountId)).toEqual(ctx.destinationBefore);
            });
        });
    });

    test.describe("envio da análise com falha (submitFailures)", () => {
        test("REC-06: Até 5 falhas no envio: o retry do envio cria a análise e a transferência completa sem reconciliação", async ({ accountService, transferService, antifraudService }) => {
            test.setTimeout(60_000);
            const ctx = await setup({ accountService, antifraudService }, { decision: "Approved", submitFailures: 3 });
            const transfer = await createTransfer(transferService, ctx.sourceAccountId, ctx.destinationAccountId, 10);

            const completed = await waitForTransferStatus(transferService, transfer.id, "Completed", 30_000);
            expect(secondsBetween(transfer.createdAt, completed.debit!.occurredAt)).toBeLessThan(STALE_AFTER_S);
            const analysis = await findAnalysis(antifraudService, transfer.endToEndId);
            expect(analysis).toMatchObject({ status: "Approved", ruleId: ctx.rule.id, transactionId: transfer.endToEndId });
            expect((await getBalance(accountService, ctx.sourceAccountId)).balance).toBeCloseTo(cents(ctx.sourceBefore.balance - 10), 2);
        });

        test("REC-07: Mais de 5 falhas no envio: a reconciliação reenvia a análise e a transferência completa", async ({ accountService, transferService, antifraudService }) => {
            test.setTimeout(90_000);
            const ctx = await setup({ accountService, antifraudService }, { decision: "Approved", submitFailures: 8 });
            const transfer = await createTransfer(transferService, ctx.sourceAccountId, ctx.destinationAccountId, 10);

            const completed = await waitForTransferStatus(transferService, transfer.id, "Completed", 55_000);
            const elapsed = secondsBetween(transfer.createdAt, completed.debit!.occurredAt);
            expect(elapsed).toBeGreaterThanOrEqual(STALE_AFTER_S);
            expect(elapsed).toBeLessThan(TIMEOUT_S);
            expect(completed.failureReason).toBeNull();
            expect(await findAnalysis(antifraudService, transfer.endToEndId)).toMatchObject({ status: "Approved", ruleId: ctx.rule.id });
            expect((await getBalance(accountService, ctx.sourceAccountId)).balance).toBeCloseTo(cents(ctx.sourceBefore.balance - 10), 2);
        });
    });
});
