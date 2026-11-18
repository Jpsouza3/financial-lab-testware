/**
 * Análises do Antifraude (v1.0.0) — POST /analyses
 *
 * Regra: 202 cria a análise Pending com Location /analyses/{id} e os campos como submetidos. Campos inválidos (R1–R6)
 * → 400 com todos os erros; host do callbackUrl fora de AllowedCallbackHosts (R7, só sem erros de R1–R6) → 422.
 * transactionId já analisado (R8) → 200 com a análise existente no estado atual, corpo ignorado, sem novo webhook.
 * Regra com submitFailures N (R9) → 503 nas N primeiras submissões de cada transactionId, depois 202.
 *
 * Estado: contas são guids aleatórios e transactionIds únicos; regras próprias escopadas por sourceAccountIds.
 */
import { randomUUID } from "node:crypto";
import { ContractValidator } from "../../core/schema/ContractValidator";
import { AnalysisResponseSchema } from "../../domains/antifraud/AnalysisResponseSchema";
import { expect, test } from "../../fixtures/ApiFixtures";
import {
    buildAnalysisBody,
    CALLBACK,
    expectAnalysisAccepted,
    getAnalysis,
    invalidAnalysisBody,
    submitAnalysis,
    uniqueTransactionId,
    waitForWebhookDone,
} from "../helpers/antifraud/analyses";
import { expectValidationProblem } from "../helpers/antifraud/problem";
import { createRule, deleteCreatedRules } from "../helpers/antifraud/rules";
import { expectProblem } from "../helpers/common/problem";

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

const MSG = {
    transactionIdRequired: "O transactionId é obrigatório.",
    transactionIdLength: "O transactionId deve ter no máximo 64 caracteres.",
    amount: "O valor deve ser maior que zero.",
    source: "A conta de origem é obrigatória.",
    destination: "A conta de destino é obrigatória.",
    callbackUrl: "O callbackUrl deve ser uma URL http(s) absoluta.",
} as const;

function transactionIdOfLength(length: number): string {
    return (uniqueTransactionId() + "x".repeat(length)).slice(0, length);
}

test.describe("POST /analyses", { tag: ["@antifraud", "@spec:analises-antifraude"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await deleteCreatedRules(antifraudService);
    });

    test.describe("criação", () => {
        test("ANL-01: Submissão válida responde 202 Pending com Location e os campos submetidos", async ({ antifraudService }) => {
            const body = buildAnalysisBody({ amount: 123.45, description: "Pagamento de aluguel" });

            const analysis = await test.step("submete", async () => {
                return expectAnalysisAccepted(await antifraudService.PostAnalysis(body), body);
            });

            await test.step("webhook ainda pendente, no modo Normal", async () => {
                expect(analysis.webhook).toEqual({ mode: "Normal", status: "Pending", attempts: [] });
            });

            await test.step("GET /analyses/{id} devolve a mesma análise", async () => {
                const got = await getAnalysis(antifraudService, analysis.id);
                expect(got).toMatchObject({
                    id: analysis.id,
                    transactionId: body.transactionId,
                    amount: body.amount,
                    sourceAccountId: body.sourceAccountId,
                    destinationAccountId: body.destinationAccountId,
                    description: body.description,
                    createdAt: analysis.createdAt,
                });
            });
        });
    });

    test.describe("validação do corpo", () => {
        test("ANL-03: Campos inválidos respondem 400 por campo", async ({ antifraudService }) => {
            const variations: { label: string, body: Record<string, unknown>, errors: Record<string, string[]> }[] = [
                { label: "transactionId ausente", body: { transactionId: undefined }, errors: { transactionId: [MSG.transactionIdRequired] } },
                { label: "transactionId só espaços", body: { transactionId: "   " }, errors: { transactionId: [MSG.transactionIdRequired] } },
                { label: "amount ausente", body: { amount: undefined }, errors: { amount: [MSG.amount] } },
                { label: "amount zero", body: { amount: 0 }, errors: { amount: [MSG.amount] } },
                { label: "amount negativo", body: { amount: -0.01 }, errors: { amount: [MSG.amount] } },
                { label: "sourceAccountId ausente", body: { sourceAccountId: undefined }, errors: { sourceAccountId: [MSG.source] } },
                { label: "sourceAccountId vazio", body: { sourceAccountId: EMPTY_GUID }, errors: { sourceAccountId: [MSG.source] } },
                { label: "destinationAccountId ausente", body: { destinationAccountId: undefined }, errors: { destinationAccountId: [MSG.destination] } },
                { label: "destinationAccountId vazio", body: { destinationAccountId: EMPTY_GUID }, errors: { destinationAccountId: [MSG.destination] } },
                { label: "callbackUrl ausente", body: { callbackUrl: undefined }, errors: { callbackUrl: [MSG.callbackUrl] } },
                { label: "callbackUrl relativo", body: { callbackUrl: "/webhooks/antifraud" }, errors: { callbackUrl: [MSG.callbackUrl] } },
                { label: "callbackUrl ftp", body: { callbackUrl: "ftp://localhost/webhook" }, errors: { callbackUrl: [MSG.callbackUrl] } },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    const body = buildAnalysisBody();
                    const res = await antifraudService.PostAnalysis(invalidAnalysisBody({ ...body, ...v.body }));
                    expectValidationProblem(res, v.errors);
                    expect((await antifraudService.GetAnalyses({ transactionId: body.transactionId })).body).toEqual([]);
                });
            }

            await test.step("todos os erros juntos", async () => {
                expectValidationProblem(await antifraudService.PostAnalysis(invalidAnalysisBody({})), {
                    transactionId: [MSG.transactionIdRequired],
                    amount: [MSG.amount],
                    sourceAccountId: [MSG.source],
                    destinationAccountId: [MSG.destination],
                    callbackUrl: [MSG.callbackUrl],
                });
            });
        });

        test("ANL-04: transactionId com 65 caracteres responde 400; 64 é aceito", async ({ antifraudService }) => {
            await test.step("65 caracteres", async () => {
                const body = buildAnalysisBody({ transactionId: transactionIdOfLength(65) });
                expectValidationProblem(await antifraudService.PostAnalysis(body), { transactionId: [MSG.transactionIdLength] });
            });

            await test.step("controle: 64 caracteres e amount 0,01", async () => {
                const body = buildAnalysisBody({ transactionId: transactionIdOfLength(64), amount: 0.01 });
                expectAnalysisAccepted(await antifraudService.PostAnalysis(body), body);
            });
        });

        test("ANL-05: Host do callbackUrl fora dos permitidos responde 422; hosts permitidos são aceitos", async ({ antifraudService }) => {
            for (const callbackUrl of ["http://evil.example.com/webhooks/antifraud", "https://transfer-api.example.com/cb"]) {
                await test.step(callbackUrl, async () => {
                    const body = buildAnalysisBody({ callbackUrl });
                    const res = await antifraudService.PostAnalysis(body);
                    expectProblem(res, 422, `O host de '${callbackUrl}' não está em AllowedCallbackHosts.`);
                    expect(res.body).toMatchObject({ title: "Callback não permitido." });
                    expect((await antifraudService.GetAnalyses({ transactionId: body.transactionId })).body).toEqual([]);
                });
            }

            for (const callbackUrl of ["http://LOCALHOST:9/webhook", "https://Transfer-Api:8443/webhooks/antifraud"]) {
                await test.step(`controle: ${callbackUrl}`, async () => {
                    const body = buildAnalysisBody({ callbackUrl });
                    expectAnalysisAccepted(await antifraudService.PostAnalysis(body), body);
                });
            }
        });

        test("ANL-06: Host não permitido não é avaliado quando há erro de campo", async ({ antifraudService }) => {
            const body = buildAnalysisBody({ amount: 0, callbackUrl: "http://evil.example.com/cb" });

            expectValidationProblem(await antifraudService.PostAnalysis(body), { amount: [MSG.amount] });
        });
    });

    test.describe("idempotência", () => {
        test("ANL-07: transactionId repetido devolve 200 com a análise existente, sem reavaliar nem novo webhook", async ({ antifraudService }) => {
            test.setTimeout(60_000);
            const body = buildAnalysisBody({ amount: 10, callbackUrl: CALLBACK.transferUnknown });
            const repeated = buildAnalysisBody({
                transactionId: body.transactionId,
                amount: 5_000,
                description: "outra descrição",
            });
            const original = expectAnalysisAccepted(await antifraudService.PostAnalysis(body), body);

            await test.step("repetição enquanto Pending", async () => {
                const res = await antifraudService.PostAnalysis(repeated);
                expect(res.status, res.text).toBe(200);
                ContractValidator.validate(AnalysisResponseSchema, res.body);
                expect(res.body).toMatchObject({ id: original.id, amount: 10, sourceAccountId: body.sourceAccountId, description: null });
            });

            const done = await waitForWebhookDone(antifraudService, original.id);
            expect(done.webhook.attempts).toHaveLength(1);

            await test.step("repetição depois da decisão devolve o estado atual", async () => {
                const res = await antifraudService.PostAnalysis(repeated);
                expect(res.status, res.text).toBe(200);
                expect(res.body).toEqual(done);
                expect(res.body).toMatchObject({ status: "Approved", ruleId: null, amount: 10 });
            });

            await test.step("nenhum webhook novo", async () => {
                await new Promise((resolve) => setTimeout(resolve, 1_500));
                expect(await getAnalysis(antifraudService, original.id)).toEqual(done);
            });

            await test.step("uma análise só para o transactionId", async () => {
                const list = await antifraudService.GetAnalyses({ transactionId: body.transactionId });
                expect(list.body.map((a) => a.id)).toEqual([original.id]);
            });
        });
    });

    test.describe("falhas simuladas", () => {
        test("ANL-08: submitFailures responde 503 nas N primeiras submissões de cada transação e depois 202", async ({ antifraudService }) => {
            const source = randomUUID();
            const rule = await createRule(antifraudService, { sourceAccountIds: [source], submitFailures: 2 });
            const body = buildAnalysisBody({ sourceAccountId: source });
            const detail = `Falha simulada pela regra ${rule.id}.`;

            for (const attempt of [1, 2]) {
                await test.step(`submissão ${attempt}: 503 sem criar análise`, async () => {
                    const res = await antifraudService.PostAnalysis(body);
                    expectProblem(res, 503, detail);
                    expect(res.body).toMatchObject({ title: "Antifraude indisponível." });
                    expect((await antifraudService.GetAnalyses({ transactionId: body.transactionId })).body).toEqual([]);
                });
            }

            await test.step("submissão 3: 202", async () => {
                expectAnalysisAccepted(await antifraudService.PostAnalysis(body), body);
            });

            await test.step("outra transação da mesma origem tem a própria contagem", async () => {
                const other = buildAnalysisBody({ sourceAccountId: source });
                expectProblem(await antifraudService.PostAnalysis(other), 503, detail);
            });

            await test.step("controle: submitFailures 0 não falha", async () => {
                const free = randomUUID();
                await createRule(antifraudService, { sourceAccountIds: [free], submitFailures: 0 });
                await submitAnalysis(antifraudService, { sourceAccountId: free });
            });
        });
    });
});
