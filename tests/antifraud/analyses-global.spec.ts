/**
 * Análises do Antifraude (v1.0.0) — GET /analyses?take e DELETE /analyses (estado global)
 *
 * Regra: GET /analyses?take=<n> devolve as últimas análises, da mais nova para a mais antiga; take padrão 50,
 * limitado entre 1 e 500. DELETE /analyses apaga todas as análises e os contadores de submitFailures e responde
 * 200 { removed: <n> }.
 *
 * Estado: @global (projeto global, 1 worker); termina com POST /rules/reset.
 */
import { randomUUID } from "node:crypto";
import { ContractValidator } from "../../core/schema/ContractValidator";
import { AnalysisResponse } from "../../domains/antifraud/AnalysisResponse";
import { AnalysisListSchema } from "../../domains/antifraud/AnalysisResponseSchema";
import { DeleteAnalysesResponseSchema } from "../../domains/antifraud/DeleteAnalysesResponseSchema";
import { expect, test } from "../../fixtures/ApiFixtures";
import { AntifraudInterface } from "../../interfaces/AntifraudInterface";
import { buildAnalysisBody, expectAnalysisAccepted, submitAnalysis } from "../helpers/antifraud/analyses";
import { createRule, deleteCreatedRules, resetRules } from "../helpers/antifraud/rules";
import { expectProblem } from "../helpers/common/problem";

async function listAnalyses(antifraudService: AntifraudInterface, take?: number): Promise<AnalysisResponse[]> {
    const res = await antifraudService.GetAnalyses({ take });
    expect(res.status, res.text).toBe(200);
    ContractValidator.validate(AnalysisListSchema, res.body);
    return res.body;
}

function expectNewestFirst(list: AnalysisResponse[]): void {
    const times = list.map((a) => Date.parse(a.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
}

test.describe("Análises globais do antifraude", { tag: ["@antifraud", "@spec:analises-antifraude", "@global"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await deleteCreatedRules(antifraudService);
        await resetRules(antifraudService);
    });

    test("ANL-31: take devolve as mais novas primeiro, com padrão 50 e limite entre 1 e 500", async ({ antifraudService }) => {
        test.setTimeout(120_000);
        const source = randomUUID();
        await createRule(antifraudService, { sourceAccountIds: [source], decision: "Approved", delayMs: 0, delivery: "Drop" });

        await test.step("garante mais de 500 análises", async () => {
            const missing = 501 - (await listAnalyses(antifraudService, 500)).length;
            for (let i = 0; i < missing; i += 50) {
                const batch = Array.from({ length: Math.min(50, missing - i) }, () => submitAnalysis(antifraudService, { sourceAccountId: source }));
                await Promise.all(batch);
            }
        });

        const latest: AnalysisResponse[] = [];
        for (let i = 0; i < 3; i++) latest.unshift(await submitAnalysis(antifraudService, { sourceAccountId: source }));

        await test.step("take 3: as três últimas, da mais nova para a mais antiga", async () => {
            expect((await listAnalyses(antifraudService, 3)).map((a) => a.id)).toEqual(latest.map((a) => a.id));
        });

        await test.step("sem take: 50", async () => {
            const list = await listAnalyses(antifraudService);
            expect(list).toHaveLength(50);
            expectNewestFirst(list);
            expect(list[0].id).toBe(latest[0].id);
        });

        for (const [take, length] of [[0, 1], [-5, 1], [1, 1], [500, 500], [501, 500], [10_000, 500]] as const) {
            await test.step(`take ${take}: ${length}`, async () => {
                const list = await listAnalyses(antifraudService, take);
                expect(list).toHaveLength(length);
                expect(list[0].id).toBe(latest[0].id);
                expectNewestFirst(list);
            });
        }
    });

    test("ANL-32: DELETE /analyses apaga as análises e zera os contadores de submitFailures", async ({ antifraudService }) => {
        const source = randomUUID();
        const rule = await createRule(antifraudService, { sourceAccountIds: [source], submitFailures: 1 });
        const body = buildAnalysisBody({ sourceAccountId: source });
        const detail = `Falha simulada pela regra ${rule.id}.`;

        const other = await submitAnalysis(antifraudService);
        await test.step("consome a falha simulada e cria a análise", async () => {
            expectProblem(await antifraudService.PostAnalysis(body), 503, detail);
            expectAnalysisAccepted(await antifraudService.PostAnalysis(body), body);
        });

        await test.step("DELETE responde 200 com removed", async () => {
            const res = await antifraudService.DeleteAnalyses();
            expect(res.status, res.text).toBe(200);
            ContractValidator.validate(DeleteAnalysesResponseSchema, res.body);
            expect(res.body.removed).toBeGreaterThanOrEqual(2);
        });

        await test.step("análises apagadas", async () => {
            expect((await antifraudService.GetAnalysis(other.id)).status).toBe(404);
            expect((await antifraudService.GetAnalyses({ transactionId: body.transactionId })).body).toEqual([]);
            expect((await antifraudService.GetAnalyses({ transactionId: other.transactionId })).body).toEqual([]);
        });

        await test.step("contador zerado: a mesma transação volta a falhar uma vez", async () => {
            expectProblem(await antifraudService.PostAnalysis(body), 503, detail);
            expectAnalysisAccepted(await antifraudService.PostAnalysis(body), body);
        });

        await test.step("segundo DELETE conta só o que foi criado depois", async () => {
            const res = await antifraudService.DeleteAnalyses();
            expect(res.status, res.text).toBe(200);
            expect(res.body.removed).toBeGreaterThanOrEqual(1);
            expect((await listAnalyses(antifraudService, 500)).map((a) => a.transactionId)).not.toContain(body.transactionId);
        });
    });
});
