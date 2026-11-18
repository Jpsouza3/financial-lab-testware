/**
 * Análises do Antifraude (v1.0.0) — GET /analyses/{analysisId} e GET /analyses?transactionId
 *
 * Regra: GET por id devolve a análise (404 sem corpo se não existir). GET ?transactionId devolve uma lista com a
 * análise da transação, ou lista vazia; comparação exata.
 *
 * Estado: transactionIds únicos e contas aleatórias. GET ?take está em analyses-global.spec.ts (@global).
 */
import { randomUUID } from "node:crypto";
import { ContractValidator } from "../../core/schema/ContractValidator";
import { AnalysisListSchema } from "../../domains/antifraud/AnalysisResponseSchema";
import { expect, test } from "../../fixtures/ApiFixtures";
import { getAnalysis, submitAnalysis, uniqueTransactionId } from "../helpers/antifraud/analyses";

test.describe("GET /analyses", { tag: ["@antifraud", "@spec:analises-antifraude"] }, () => {
    test("ANL-09: Análise inexistente responde 404 sem corpo", async ({ antifraudService }) => {
        const res = await antifraudService.GetAnalysis(randomUUID());

        expect(res.status).toBe(404);
        expect(res.text).toBe("");
    });

    test("ANL-10: Busca por transactionId é exata e devolve lista vazia quando não acha", async ({ antifraudService }) => {
        const transactionId = `${uniqueTransactionId()}-AbC`;
        const analysis = await submitAnalysis(antifraudService, { transactionId });

        await test.step("mesmo transactionId", async () => {
            const res = await antifraudService.GetAnalyses({ transactionId });
            expect(res.status, res.text).toBe(200);
            ContractValidator.validate(AnalysisListSchema, res.body);
            expect(res.body).toHaveLength(1);
            expect(res.body[0]).toEqual(await getAnalysis(antifraudService, analysis.id));
        });

        for (const [label, other] of [
            ["outra grafia", transactionId.toLowerCase()],
            ["prefixo", transactionId.slice(0, -1)],
            ["inexistente", uniqueTransactionId()],
        ]) {
            await test.step(label, async () => {
                const res = await antifraudService.GetAnalyses({ transactionId: other });
                expect(res.status, res.text).toBe(200);
                expect(res.body).toEqual([]);
            });
        }
    });
});
