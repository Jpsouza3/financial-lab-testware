/**
 * Regras do Antifraude (v1.0.0) — PUT /rules/{id}
 *
 * Regra: id novo → 201 (adicionada no fim, Location /rules/{id}); id existente (sem diferenciar maiúsculas) → 200,
 * substituída na mesma posição. O id da rota substitui o do corpo. Validação igual à de POST (chaves `rule.<campo>`);
 * em erro a regra não muda. Regras alteradas só afetam análises criadas depois.
 *
 * Estado: regras próprias com id único, escopadas por sourceAccountIds aleatório, removidas no fim.
 */
import { randomUUID } from "node:crypto";
import { ContractValidator } from "../../core/schema/ContractValidator";
import { FraudRuleSchema } from "../../domains/antifraud/FraudRuleSchema";
import { RuleBody } from "../../domains/antifraud/RuleBody";
import { expect, test } from "../../fixtures/ApiFixtures";
import {
    expectRejectedBy,
    getAnalysis,
    submitAnalysis,
    waitForDecision,
} from "../helpers/antifraud/analyses";
import { expectValidationProblem } from "../helpers/antifraud/problem";
import {
    createRule,
    deleteCreatedRules,
    expectedRule,
    expectRuleAbsent,
    expectRuleCreated,
    getRules,
    ruleIndex,
    trackRule,
    uniqueRuleId,
} from "../helpers/antifraud/rules";

test.describe("PUT /rules/{id}", { tag: ["@antifraud", "@spec:regras-antifraude"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await deleteCreatedRules(antifraudService);
    });

    test.describe("criação e substituição", () => {
        test("RUL-14: id novo cria a regra no fim da lista com 201", async ({ antifraudService }) => {
            const before = await createRule(antifraudService);
            const id = uniqueRuleId();
            const body: RuleBody = { id, decision: "Approved", reason: "Via PUT", sourceAccountIds: [randomUUID()] };

            const res = await antifraudService.PutRule(id, body);
            trackRule(id);

            expectRuleCreated(res, body);
            expect(await ruleIndex(antifraudService, id)).toBeGreaterThan(await ruleIndex(antifraudService, before.id));
            expect((await antifraudService.GetRule(id)).body).toEqual(res.body);
        });

        test("RUL-15: id existente substitui a regra inteira na mesma posição com 200", async ({ antifraudService }) => {
            const target = await createRule(antifraudService, { reason: "Antes", minAmount: 5, delivery: "Duplicate" });
            const after = await createRule(antifraudService);
            const positionBefore = await ruleIndex(antifraudService, target.id);
            const body: RuleBody = { decision: "Approved", reason: "Depois", sourceAccountIds: target.sourceAccountIds };

            const res = await test.step("substitui", async () => {
                const put = await antifraudService.PutRule(target.id, body);
                expect(put.status, put.text).toBe(200);
                ContractValidator.validate(FraudRuleSchema, put.body);
                expect(put.body).toEqual(expectedRule({ ...body, id: target.id }));
                return put.body;
            });

            await test.step("mesma posição, antes da regra criada depois", async () => {
                expect(await ruleIndex(antifraudService, target.id)).toBe(positionBefore);
                expect(await ruleIndex(antifraudService, after.id)).toBeGreaterThan(positionBefore);
            });

            await test.step("GET devolve o novo conteúdo", async () => {
                expect((await antifraudService.GetRule(target.id)).body).toEqual(res);
            });
        });

        test("RUL-16: id da rota substitui o id do corpo", async ({ antifraudService }) => {
            const routeId = uniqueRuleId();
            const bodyId = uniqueRuleId();

            const res = await antifraudService.PutRule(routeId, { id: bodyId, sourceAccountIds: [randomUUID()] });
            trackRule(routeId);
            trackRule(bodyId);

            expect(res.status, res.text).toBe(201);
            expect(res.body.id).toBe(routeId);
            expect(res.headers["location"]).toBe(`/rules/${routeId}`);
            await expectRuleAbsent(antifraudService, bodyId);
        });

        test("RUL-26: id existente em outra grafia substitui a mesma regra", async ({ antifraudService }) => {
            const target = await createRule(antifraudService, { reason: "Antes" });

            const res = await antifraudService.PutRule(target.id.toUpperCase(), {
                reason: "Depois",
                sourceAccountIds: target.sourceAccountIds,
            });
            trackRule(target.id.toUpperCase());

            expect(res.status, res.text).toBe(200);
            const matches = (await getRules(antifraudService)).filter((r) => r.id.toLowerCase() === target.id);
            expect(matches).toHaveLength(1);
            expect(matches[0].reason).toBe("Depois");
        });
    });

    test.describe("validação", () => {
        test("RUL-17: corpo inválido responde 400 e não altera a regra existente", async ({ antifraudService }) => {
            const existing = await createRule(antifraudService, { reason: "Intacta" });

            await test.step("delayMs 120001 e submitFailures 21", async () => {
                const res = await antifraudService.PutRule(existing.id, { delayMs: 120_001, submitFailures: 21 });
                expectValidationProblem(res, {
                    "rule.delayMs": ["O atraso deve estar entre 0 e 120000 ms."],
                    "rule.submitFailures": ["As falhas de envio devem estar entre 0 e 20."],
                });
                expect((await antifraudService.GetRule(existing.id)).body).toEqual(existing);
            });

            await test.step("id da rota com 65 caracteres", async () => {
                const tooLong = (uniqueRuleId() + "x".repeat(65)).slice(0, 65);
                const res = await antifraudService.PutRule(tooLong, { sourceAccountIds: [randomUUID()] });
                expectValidationProblem(res, { "rule.id": ["O id deve ter no máximo 64 caracteres."] });
                await expectRuleAbsent(antifraudService, tooLong);
            });
        });
    });

    test.describe("efeito nas análises", () => {
        test("RUL-19: Regra alterada só afeta análises submetidas depois", async ({ antifraudService }) => {
            test.setTimeout(60_000);
            const source = randomUUID();
            const rule = await createRule(antifraudService, {
                sourceAccountIds: [source],
                reason: "Regra original",
                delayMs: 2_000,
            });

            const pending = await test.step("submete enquanto a regra recusa com atraso", async () => {
                const analysis = await submitAnalysis(antifraudService, { sourceAccountId: source });
                expect(analysis.status).toBe("Pending");
                return analysis;
            });

            await test.step("altera a regra antes da decisão", async () => {
                const res = await antifraudService.PutRule(rule.id, {
                    sourceAccountIds: [source],
                    decision: "Approved",
                    reason: "Regra alterada",
                    delayMs: 0,
                    delivery: "Drop",
                });
                expect(res.status, res.text).toBe(200);
                expect((await getAnalysis(antifraudService, pending.id)).status).toBe("Pending");
            });

            await test.step("análise já submetida mantém decisão, atraso e entrega da regra original", async () => {
                const decided = await waitForDecision(antifraudService, pending.id);
                expectRejectedBy(decided, rule.id, "Regra original");
                expect(decided.webhook.mode).toBe("Normal");
                expect(Date.parse(decided.decidedAt!) - Date.parse(decided.createdAt)).toBeGreaterThanOrEqual(1_900);
            });

            await test.step("análise submetida depois usa a regra alterada", async () => {
                const analysis = await submitAnalysis(antifraudService, { sourceAccountId: source });
                expect(analysis.webhook.mode).toBe("Drop");
                const decided = await waitForDecision(antifraudService, analysis.id);
                expect(decided).toMatchObject({ status: "Approved", ruleId: rule.id, reason: "Regra alterada" });
            });
        });
    });
});
