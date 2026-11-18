/**
 * Webhook do Antifraude (v1.0.0) — POST /webhooks/antifraud (Transfer API)
 *
 * Regra: a decisão do antifraude chega assinada (`sha256=` + HMAC-SHA256 hex minúsculo de `<timestamp>.<corpo>`,
 * tolerância de 300 s). Ordem: assinatura/timestamp (401 "Assinatura inválida."), payload (400 "Payload inválido."),
 * transferência pelo endToEndId (404 sem corpo). Só uma transferência em Screening muda: Approved → Debiting (segue
 * até Completed), Rejected → FraudRejected com `reason` ou "Recusada pelo antifraude.". Fora de Screening responde 200
 * com o status atual e nada muda (webhook repetido não debita de novo; decisão contrária é ignorada).
 *
 * Os testes assinam o webhook com o segredo público do laboratório. A transferência fica parada em Screening por uma
 * regra própria com `delivery` Drop e `delayMs` 120000 (tests/helpers/webhook/screening.ts).
 * Fora do escopo (v1.0.0): R6 (409 por conflito de concorrência), que depende de corrida interna da Transfer API;
 * decisão em minúsculas ou numérica (o conversor de enum do SUT aceita, a spec não define).
 * Webhook depois do timeout de reconciliação: tests/transfer/reconciliation.spec.ts.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "../../fixtures/ApiFixtures";
import { openAccountId } from "../helpers/account/accounts";
import { cents, getBalance } from "../helpers/account/holds";
import { RuleScope } from "../helpers/e2e/rules";
import { createTransfer, expectTransferUnchanged, getTransfer, REASON, waitForTransferStatus, waitNoEffectWindow } from "../helpers/e2e/transfers";
import { HOLD_SCREENING_DELAY_MS, openScreeningTransfer } from "../helpers/webhook/screening";
import {
    buildWebhookBody,
    expectWebhookAck,
    expectWebhookNotFound,
    expectWebhookProblem,
    hmacSha256Hex,
    sendDecision,
    signedHeaders,
    signWebhook,
    SIGNATURE_TOLERANCE_SECONDS,
    unixNow,
    WEBHOOK_CONTENT_TYPE,
    WEBHOOK_TITLE,
} from "../helpers/webhook/signature";

const rules = new RuleScope();

test.describe("POST /webhooks/antifraud", { tag: ["@transfer", "@spec:webhook-antifraude"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await rules.cleanup(antifraudService);
    });

    test.describe("decisão em Screening", () => {
        test("WHK-01: Approved leva a Debiting e a transferência segue até Completed", async ({ accountService, transferService, antifraudService }) => {
            const { transfer, sourceAccountId, destinationAccountId } = await openScreeningTransfer(
                { accountService, transferService, antifraudService }, rules, { amount: 10 });
            const sourceBefore = await getBalance(accountService, sourceAccountId);
            const destinationBefore = await getBalance(accountService, destinationAccountId);

            await test.step("webhook Approved responde 200 com Debiting", async () => {
                expectWebhookAck(await sendDecision(transferService, transfer.endToEndId, "Approved"), transfer.id, "Debiting");
            });

            await test.step("transferência termina Completed com débito e crédito", async () => {
                const done = await waitForTransferStatus(transferService, transfer.id, "Completed");
                expect(done.failureReason).toBeNull();
                expect(done.debit).toMatchObject({ accountId: sourceAccountId, endToEndId: transfer.endToEndId });
                expect(done.credit).toMatchObject({ accountId: destinationAccountId, endToEndId: transfer.endToEndId });
                expect(done.refund).toBeNull();
            });

            await test.step("saldos: origem − amount, destino + amount", async () => {
                const sourceAfter = await getBalance(accountService, sourceAccountId);
                const destinationAfter = await getBalance(accountService, destinationAccountId);
                expect(sourceAfter.balance).toBeCloseTo(cents(sourceBefore.balance - 10), 2);
                expect(sourceAfter.version).toBe(sourceBefore.version + 1);
                expect(destinationAfter.balance).toBeCloseTo(cents(destinationBefore.balance + 10), 2);
                expect(destinationAfter.version).toBe(destinationBefore.version + 1);
            });
        });

        test("WHK-02: Rejected com reason leva a FraudRejected com esse motivo e não movimenta as contas", async ({ accountService, transferService, antifraudService }) => {
            const { transfer, sourceAccountId, destinationAccountId } = await openScreeningTransfer(
                { accountService, transferService, antifraudService }, rules);
            const sourceBefore = await getBalance(accountService, sourceAccountId);
            const destinationBefore = await getBalance(accountService, destinationAccountId);
            const reason = "Suspeita de fraude no teste automatizado.";

            expectWebhookAck(await sendDecision(transferService, transfer.endToEndId, "Rejected", reason), transfer.id, "FraudRejected");

            const rejected = await getTransfer(transferService, transfer.id);
            expect(rejected).toMatchObject({ status: "FraudRejected", failureReason: reason, debit: null, credit: null, refund: null });
            expect(Date.parse(rejected.updatedAt)).toBeGreaterThan(Date.parse(transfer.updatedAt));

            await test.step("nenhum efeito nas contas", async () => {
                await waitNoEffectWindow();
                expect(await getBalance(accountService, sourceAccountId)).toEqual(sourceBefore);
                expect(await getBalance(accountService, destinationAccountId)).toEqual(destinationBefore);
            });
        });

        test("WHK-03: Rejected sem reason usa 'Recusada pelo antifraude.'", async ({ accountService, transferService, antifraudService }) => {
            const sourceAccountId = await openAccountId(accountService);
            const destinationAccountId = await openAccountId(accountService);
            await rules.create(antifraudService, sourceAccountId, { decision: "Approved", delayMs: HOLD_SCREENING_DELAY_MS, delivery: "Drop" });

            const variations: { label: string; body: (transactionId: string) => string }[] = [
                { label: "reason null", body: (id) => buildWebhookBody(id, "Rejected", null) },
                { label: "reason ausente", body: (id) => JSON.stringify({ analysisId: randomUUID(), transactionId: id, decision: "Rejected" }) },
                { label: "reason vazio", body: (id) => buildWebhookBody(id, "Rejected", "") },
                { label: "reason só com espaços", body: (id) => buildWebhookBody(id, "Rejected", "   ") },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    const transfer = await createTransfer(transferService, sourceAccountId, destinationAccountId, 1);
                    const body = v.body(transfer.endToEndId);
                    expectWebhookAck(await transferService.PostAntifraudWebhook(body, signedHeaders(body)), transfer.id, "FraudRejected");
                    expect(await getTransfer(transferService, transfer.id)).toMatchObject({
                        status: "FraudRejected",
                        failureReason: REASON.rejectedByAntifraud,
                    });
                });
            }
        });
    });

    test.describe("assinatura", () => {
        test("WHK-04: Header de timestamp ou de assinatura ausente responde 401 e não muda a transferência", async ({ accountService, transferService, antifraudService }) => {
            const { transfer } = await openScreeningTransfer({ accountService, transferService, antifraudService }, rules);
            const body = buildWebhookBody(transfer.endToEndId, "Approved");
            const valid = signedHeaders(body);

            const variations: { label: string; headers: Record<string, string> }[] = [
                { label: "sem X-Antifraud-Timestamp", headers: { ...WEBHOOK_CONTENT_TYPE, "X-Antifraud-Signature": valid["X-Antifraud-Signature"] } },
                { label: "sem X-Antifraud-Signature", headers: { ...WEBHOOK_CONTENT_TYPE, "X-Antifraud-Timestamp": valid["X-Antifraud-Timestamp"] } },
                { label: "sem os dois headers", headers: { ...WEBHOOK_CONTENT_TYPE } },
                { label: "timestamp vazio", headers: { ...valid, "X-Antifraud-Timestamp": "" } },
            ];
            for (const v of variations) {
                await test.step(`401: ${v.label}`, async () => {
                    expectWebhookProblem(await transferService.PostAntifraudWebhook(body, v.headers), 401, WEBHOOK_TITLE.signature);
                });
            }
            expectTransferUnchanged(transfer, await getTransfer(transferService, transfer.id));

            await test.step("controle 200: mesmo corpo com os headers válidos", async () => {
                expectWebhookAck(await transferService.PostAntifraudWebhook(body, signedHeaders(body)), transfer.id, "Debiting");
            });
        });

        test("WHK-05: Assinatura que não confere responde 401 e não muda a transferência", async ({ accountService, transferService, antifraudService }) => {
            const { transfer } = await openScreeningTransfer({ accountService, transferService, antifraudService }, rules);
            const body = buildWebhookBody(transfer.endToEndId, "Approved");
            const ts = unixNow();
            const good = signWebhook(ts, body);
            const hex = good.slice("sha256=".length);
            const bodyOnlyHmac = `sha256=${hmacSha256Hex(body)}`;

            const variations: { label: string; sent: string; timestamp: string; signature: string }[] = [
                { label: "segredo errado", sent: body, timestamp: ts, signature: signWebhook(ts, body, "outro-segredo") },
                { label: "corpo alterado depois de assinar", sent: body.replace("Approved", "Rejected"), timestamp: ts, signature: good },
                { label: "corpo com espaço a mais", sent: `${body} `, timestamp: ts, signature: good },
                { label: "timestamp diferente do assinado", sent: body, timestamp: String(Number(ts) - 1), signature: good },
                { label: "HMAC só do corpo, sem o timestamp", sent: body, timestamp: ts, signature: bodyOnlyHmac },
                { label: "hex em maiúsculas", sent: body, timestamp: ts, signature: `sha256=${hex.toUpperCase()}` },
                { label: "sem o prefixo sha256=", sent: body, timestamp: ts, signature: hex },
                { label: "prefixo de outro algoritmo", sent: body, timestamp: ts, signature: `sha1=${hex}` },
                { label: "assinatura vazia", sent: body, timestamp: ts, signature: "" },
                { label: "só o prefixo", sent: body, timestamp: ts, signature: "sha256=" },
            ];
            for (const v of variations) {
                await test.step(`401: ${v.label}`, async () => {
                    const res = await transferService.PostAntifraudWebhook(v.sent, {
                        ...WEBHOOK_CONTENT_TYPE,
                        "X-Antifraud-Timestamp": v.timestamp,
                        "X-Antifraud-Signature": v.signature,
                    });
                    expectWebhookProblem(res, 401, WEBHOOK_TITLE.signature);
                });
            }
            expectTransferUnchanged(transfer, await getTransfer(transferService, transfer.id));

            await test.step("controle 200: assinatura correta", async () => {
                const res = await transferService.PostAntifraudWebhook(body, { ...WEBHOOK_CONTENT_TYPE, "X-Antifraud-Timestamp": ts, "X-Antifraud-Signature": good });
                expectWebhookAck(res, transfer.id, "Debiting");
            });
        });

        test("WHK-06: Timestamp não numérico ou fora da tolerância de 300 s responde 401", async ({ accountService, transferService, antifraudService }) => {
            const { transfer } = await openScreeningTransfer({ accountService, transferService, antifraudService }, rules);
            const body = buildWebhookBody(transfer.endToEndId, "Approved");
            const margin = 30;

            const variations: { label: string; timestamp: string }[] = [
                { label: "não numérico", timestamp: "agora" },
                { label: "data ISO 8601", timestamp: new Date().toISOString() },
                { label: "decimal", timestamp: `${unixNow()}.5` },
                { label: "em milissegundos", timestamp: String(Date.now()) },
                { label: `${SIGNATURE_TOLERANCE_SECONDS + margin} s no passado`, timestamp: unixNow(-(SIGNATURE_TOLERANCE_SECONDS + margin)) },
                { label: "1 hora no passado", timestamp: unixNow(-3_600) },
                { label: `${SIGNATURE_TOLERANCE_SECONDS + margin} s no futuro`, timestamp: unixNow(SIGNATURE_TOLERANCE_SECONDS + margin) },
            ];
            for (const v of variations) {
                await test.step(`401: ${v.label}`, async () => {
                    const res = await transferService.PostAntifraudWebhook(body, signedHeaders(body, v.timestamp));
                    expectWebhookProblem(res, 401, WEBHOOK_TITLE.signature);
                });
            }
            expectTransferUnchanged(transfer, await getTransfer(transferService, transfer.id));

            await test.step(`controle 200: ${SIGNATURE_TOLERANCE_SECONDS - margin} s no passado`, async () => {
                const res = await transferService.PostAntifraudWebhook(body, signedHeaders(body, unixNow(-(SIGNATURE_TOLERANCE_SECONDS - margin))));
                expectWebhookAck(res, transfer.id, "Debiting");
            });
            await test.step(`controle 200: ${SIGNATURE_TOLERANCE_SECONDS - margin} s no futuro`, async () => {
                const res = await transferService.PostAntifraudWebhook(body, signedHeaders(body, unixNow(SIGNATURE_TOLERANCE_SECONDS - margin)));
                expect(res.status, res.text).toBe(200);
                expect(res.body.transferId).toBe(transfer.id);
                expect(res.body.status).not.toBe("Screening");
            });
        });

        test("WHK-07: Assinatura é verificada antes do corpo e da transferência", async ({ accountService, transferService, antifraudService }) => {
            const { transfer } = await openScreeningTransfer({ accountService, transferService, antifraudService }, rules);
            const forged = { ...WEBHOOK_CONTENT_TYPE, "X-Antifraud-Timestamp": unixNow(), "X-Antifraud-Signature": "sha256=" + "0".repeat(64) };

            const variations: { label: string; body: string }[] = [
                { label: "corpo que não é JSON", body: "isto não é json" },
                { label: "decision Pending", body: JSON.stringify({ transactionId: transfer.endToEndId, decision: "Pending" }) },
                { label: "transactionId desconhecido", body: buildWebhookBody(`E99999999${Date.now()}`, "Approved") },
                { label: "decisão válida da transferência", body: buildWebhookBody(transfer.endToEndId, "Rejected", "forjado") },
            ];
            for (const v of variations) {
                await test.step(`401: ${v.label}`, async () => {
                    expectWebhookProblem(await transferService.PostAntifraudWebhook(v.body, forged), 401, WEBHOOK_TITLE.signature);
                });
            }
            expectTransferUnchanged(transfer, await getTransfer(transferService, transfer.id));
        });
    });

    test.describe("payload", () => {
        test("WHK-08: Payload inválido assinado corretamente responde 400 e não muda a transferência", async ({ accountService, transferService, antifraudService }) => {
            const { transfer } = await openScreeningTransfer({ accountService, transferService, antifraudService }, rules);
            const id = transfer.endToEndId;

            const variations: { label: string; body: string }[] = [
                { label: "corpo vazio", body: "" },
                { label: "corpo só com espaços", body: "   " },
                { label: "não é JSON", body: "decision=Approved" },
                { label: "JSON truncado", body: `{"transactionId":"${id}","decision":"Approved"` },
                { label: "JSON null", body: "null" },
                { label: "array", body: "[]" },
                { label: "transactionId ausente", body: JSON.stringify({ decision: "Approved" }) },
                { label: "transactionId vazio", body: JSON.stringify({ transactionId: "", decision: "Approved" }) },
                { label: "transactionId só com espaços", body: JSON.stringify({ transactionId: "   ", decision: "Approved" }) },
                { label: "decision ausente", body: JSON.stringify({ transactionId: id }) },
                { label: "decision null", body: JSON.stringify({ transactionId: id, decision: null }) },
                { label: "decision Pending", body: JSON.stringify({ transactionId: id, decision: "Pending" }) },
                { label: "decision desconhecida", body: JSON.stringify({ transactionId: id, decision: "Talvez" }) },
                { label: "decision vazia", body: JSON.stringify({ transactionId: id, decision: "" }) },
            ];
            for (const v of variations) {
                await test.step(`400: ${v.label}`, async () => {
                    expectWebhookProblem(await transferService.PostAntifraudWebhook(v.body, signedHeaders(v.body)), 400, WEBHOOK_TITLE.payload);
                });
            }
            expectTransferUnchanged(transfer, await getTransfer(transferService, transfer.id));

            await test.step("controle 200: só os campos obrigatórios", async () => {
                const body = JSON.stringify({ transactionId: id, decision: "Approved" });
                expectWebhookAck(await transferService.PostAntifraudWebhook(body, signedHeaders(body)), transfer.id, "Debiting");
            });
        });
    });

    test.describe("transferência inexistente", () => {
        test("WHK-09: transactionId sem transferência responde 404 sem corpo", async ({ transferService }) => {
            const unknown = [
                { label: "endToEndId bem formado inexistente", transactionId: `E99999999${"202611180000"}${randomUUID().replace(/-/g, "").slice(0, 11)}` },
                { label: "texto qualquer", transactionId: `nao-existe-${randomUUID()}` },
            ];
            for (const v of unknown) {
                await test.step(`404: ${v.label}`, async () => {
                    for (const decision of ["Approved", "Rejected"] as const) {
                        expectWebhookNotFound(await sendDecision(transferService, v.transactionId, decision));
                    }
                });
            }
        });

        test("WHK-10: refundEndToEndId de uma transferência estornada responde 404 e não muda nada", async ({ accountService, transferService }) => {
            const sourceAccountId = await openAccountId(accountService);
            const destinationAccountId = await openAccountId(accountService, { initialDeposit: 0, status: "Closed" });
            const created = await createTransfer(transferService, sourceAccountId, destinationAccountId, 5);
            const refunded = await waitForTransferStatus(transferService, created.id, "Refunded");
            expect(refunded.refundEndToEndId).not.toBeNull();
            const sourceBefore = await getBalance(accountService, sourceAccountId);

            for (const decision of ["Approved", "Rejected"] as const) {
                await test.step(`404: ${decision} com o refundEndToEndId`, async () => {
                    expectWebhookNotFound(await sendDecision(transferService, refunded.refundEndToEndId!, decision));
                });
            }
            expectTransferUnchanged(refunded, await getTransfer(transferService, created.id));
            expect(await getBalance(accountService, sourceAccountId)).toEqual(sourceBefore);
        });
    });

    test.describe("idempotência e decisão fora de Screening", () => {
        test("WHK-11: Webhook Approved repetido não gera segundo débito", async ({ accountService, transferService, antifraudService }) => {
            const { transfer, sourceAccountId, destinationAccountId } = await openScreeningTransfer(
                { accountService, transferService, antifraudService }, rules, { amount: 10 });
            const sourceBefore = await getBalance(accountService, sourceAccountId);
            const destinationBefore = await getBalance(accountService, destinationAccountId);
            const body = buildWebhookBody(transfer.endToEndId, "Approved");
            const headers = signedHeaders(body);

            await test.step("primeira entrega: Debiting", async () => {
                expectWebhookAck(await transferService.PostAntifraudWebhook(body, headers), transfer.id, "Debiting");
            });
            await test.step("mesma entrega reenviada: 200 com o status atual, sem voltar a Screening", async () => {
                const res = await transferService.PostAntifraudWebhook(body, headers);
                expect(res.status, res.text).toBe(200);
                expect(res.body.transferId).toBe(transfer.id);
                expect(["Debiting", "Crediting", "Completed"]).toContain(res.body.status);
            });

            const completed = await waitForTransferStatus(transferService, transfer.id, "Completed");

            await test.step("nova entrega depois de Completed: 200 Completed", async () => {
                expectWebhookAck(await sendDecision(transferService, transfer.endToEndId, "Approved"), transfer.id, "Completed");
            });

            await test.step("um único débito e um único crédito", async () => {
                await waitNoEffectWindow();
                const sourceAfter = await getBalance(accountService, sourceAccountId);
                const destinationAfter = await getBalance(accountService, destinationAccountId);
                expect(sourceAfter.balance).toBeCloseTo(cents(sourceBefore.balance - 10), 2);
                expect(sourceAfter.version).toBe(sourceBefore.version + 1);
                expect(destinationAfter.balance).toBeCloseTo(cents(destinationBefore.balance + 10), 2);
                expect(destinationAfter.version).toBe(destinationBefore.version + 1);
                expectTransferUnchanged(completed, await getTransfer(transferService, transfer.id));
            });
        });

        test("WHK-12: Approved depois de Rejected é ignorado e nada é debitado", async ({ accountService, transferService, antifraudService }) => {
            const { transfer, sourceAccountId, destinationAccountId } = await openScreeningTransfer(
                { accountService, transferService, antifraudService }, rules);
            const sourceBefore = await getBalance(accountService, sourceAccountId);
            const destinationBefore = await getBalance(accountService, destinationAccountId);
            const reason = "Primeira decisão: recusa.";

            expectWebhookAck(await sendDecision(transferService, transfer.endToEndId, "Rejected", reason), transfer.id, "FraudRejected");
            const rejected = await getTransfer(transferService, transfer.id);

            await test.step("Approved em seguida: 200 com FraudRejected", async () => {
                expectWebhookAck(await sendDecision(transferService, transfer.endToEndId, "Approved"), transfer.id, "FraudRejected");
            });
            await test.step("Rejected com outro motivo: 200 com FraudRejected", async () => {
                expectWebhookAck(await sendDecision(transferService, transfer.endToEndId, "Rejected", "Outro motivo."), transfer.id, "FraudRejected");
            });

            await test.step("transferência e saldos intactos", async () => {
                await waitNoEffectWindow();
                const after = await getTransfer(transferService, transfer.id);
                expectTransferUnchanged(rejected, after);
                expect(after.failureReason).toBe(reason);
                expect(await getBalance(accountService, sourceAccountId)).toEqual(sourceBefore);
                expect(await getBalance(accountService, destinationAccountId)).toEqual(destinationBefore);
            });
        });

        test("WHK-13: Rejected depois de Approved é ignorado e a transferência termina Completed", async ({ accountService, transferService, antifraudService }) => {
            const { transfer, sourceAccountId } = await openScreeningTransfer({ accountService, transferService, antifraudService }, rules, { amount: 10 });
            const sourceBefore = await getBalance(accountService, sourceAccountId);

            expectWebhookAck(await sendDecision(transferService, transfer.endToEndId, "Approved"), transfer.id, "Debiting");

            await test.step("Rejected em seguida: 200 sem FraudRejected", async () => {
                const res = await sendDecision(transferService, transfer.endToEndId, "Rejected", "Decisão revista.");
                expect(res.status, res.text).toBe(200);
                expect(res.body.transferId).toBe(transfer.id);
                expect(["Debiting", "Crediting", "Completed"]).toContain(res.body.status);
            });

            const done = await waitForTransferStatus(transferService, transfer.id, "Completed");
            expect(done.failureReason).toBeNull();
            expect(done.refundEndToEndId).toBeNull();
            expect((await getBalance(accountService, sourceAccountId)).balance).toBeCloseTo(cents(sourceBefore.balance - 10), 2);
        });
    });
});
