/**
 * Regras do Antifraude (v1.0.0) — PUT /rules e POST /rules/reset (estado global)
 *
 * Regra: PUT /rules substitui a lista inteira (200 com a lista resultante, na ordem enviada; lista vazia aceita e
 * toda análise passa a ser aprovada). Ids repetidos (sem diferenciar maiúsculas) → 400 `rules`; erros por regra usam
 * o índice (`rules[i].<campo>`); em erro, a lista não muda. POST /rules/reset volta às regras de configuração
 * (conteúdo e ordem), descartando adições, alterações e remoções.
 *
 * Estado: @global (projeto global, 1 worker); cada teste começa e termina com POST /rules/reset.
 */
import { randomUUID } from "node:crypto";
import { ContractValidator } from "../../core/schema/ContractValidator";
import { FraudRuleListSchema } from "../../domains/antifraud/FraudRuleSchema";
import { RuleBody } from "../../domains/antifraud/RuleBody";
import { expect, test } from "../../fixtures/ApiFixtures";
import { decide, expectApprovedWithoutRule, expectRejectedBy } from "../helpers/antifraud/analyses";
import { expectValidationProblem } from "../helpers/antifraud/problem";
import {
    DEFAULT_RULES,
    expectedRule,
    expectRuleAbsent,
    getRules,
    resetRules,
    uniqueRuleId,
} from "../helpers/antifraud/rules";

test.describe("Regras globais do antifraude", { tag: ["@antifraud", "@spec:regras-antifraude", "@global"] }, () => {
    test.beforeEach(async ({ antifraudService }) => {
        await resetRules(antifraudService);
    });

    test.afterEach(async ({ antifraudService }) => {
        await resetRules(antifraudService);
    });

    test.describe("POST /rules/reset", () => {
        test("RUL-20: Reset descarta regras adicionadas, alteradas e removidas", async ({ antifraudService }) => {
            const added = uniqueRuleId();

            await test.step("adiciona, altera valor-alto e remove destino-bloqueado", async () => {
                expect((await antifraudService.PostRule({ id: added, sourceAccountIds: [randomUUID()] })).status).toBe(201);
                const put = await antifraudService.PutRule("valor-alto", { decision: "Approved", minAmount: 5_000 });
                expect(put.status, put.text).toBe(200);
                expect((await antifraudService.DeleteRule("destino-bloqueado")).status).toBe(204);
                expect(await getRules(antifraudService)).not.toEqual(DEFAULT_RULES);
            });

            await test.step("reset devolve a lista de configuração", async () => {
                const res = await antifraudService.ResetRules();
                expect(res.status, res.text).toBe(200);
                ContractValidator.validate(FraudRuleListSchema, res.body);
                expect(res.body).toEqual(DEFAULT_RULES);
            });

            await test.step("lista e regras voltam ao conteúdo e à ordem da configuração", async () => {
                expect(await getRules(antifraudService)).toEqual(DEFAULT_RULES);
                await expectRuleAbsent(antifraudService, added);
            });
        });

        test("RUL-25: Regra padrão alterada muda a decisão até o reset", async ({ antifraudService }) => {
            test.setTimeout(60_000);
            const reason = DEFAULT_RULES[0].reason!;

            await test.step("valor-alto passa a recusar a partir de 500,00", async () => {
                const res = await antifraudService.PutRule("valor-alto", { ...DEFAULT_RULES[0], minAmount: 500 });
                expect(res.status, res.text).toBe(200);
                expectRejectedBy(await decide(antifraudService, { amount: 500 }), "valor-alto", reason);
            });

            await test.step("depois do reset, 500,00 é aprovado e 1000,00 recusado", async () => {
                await resetRules(antifraudService);
                expectApprovedWithoutRule(await decide(antifraudService, { amount: 500 }));
                expectRejectedBy(await decide(antifraudService, { amount: 1_000 }), "valor-alto", reason);
            });
        });
    });

    test.describe("PUT /rules", () => {
        test("RUL-21: Substitui a lista inteira, na ordem enviada", async ({ antifraudService }) => {
            const body: RuleBody[] = [
                { id: uniqueRuleId(), decision: "Approved", sourceAccountIds: [randomUUID()] },
                { id: uniqueRuleId(), reason: "Segunda", maxAmount: 10, sourceAccountIds: [randomUUID()] },
            ];
            const expected = body.map(expectedRule);

            const res = await antifraudService.PutRules(body);

            expect(res.status, res.text).toBe(200);
            ContractValidator.validate(FraudRuleListSchema, res.body);
            expect(res.body).toEqual(expected);
            expect(await getRules(antifraudService)).toEqual(expected);
            await expectRuleAbsent(antifraudService, "valor-alto");
        });

        test("RUL-22: Lista vazia é aceita e toda análise é aprovada", async ({ antifraudService }) => {
            const res = await antifraudService.PutRules([]);
            expect(res.status, res.text).toBe(200);
            expect(res.body).toEqual([]);
            expect(await getRules(antifraudService)).toEqual([]);

            expectApprovedWithoutRule(await decide(antifraudService, { amount: 5_000 }));
        });

        test("RUL-23: Ids repetidos sem diferenciar maiúsculas respondem 400 e a lista não muda", async ({ antifraudService }) => {
            const id = uniqueRuleId();

            const res = await antifraudService.PutRules([
                { id, sourceAccountIds: [randomUUID()] },
                { id: "outra-regra", sourceAccountIds: [randomUUID()] },
                { id: id.toUpperCase(), sourceAccountIds: [randomUUID()] },
            ]);

            expectValidationProblem(res, { rules: [`Ids de regra repetidos: ${id}.`] });
            expect(await getRules(antifraudService)).toEqual(DEFAULT_RULES);
        });

        test("RUL-24: Erros por regra usam o índice e nada é aplicado", async ({ antifraudService }) => {
            const res = await antifraudService.PutRules([
                { id: uniqueRuleId(), sourceAccountIds: [randomUUID()] },
                { id: "", sourceAccountIds: [randomUUID()] },
                { id: uniqueRuleId(), delayMs: 120_001, minAmount: 2, maxAmount: 1 },
            ]);

            expectValidationProblem(res, {
                "rules[1].id": ["O id é obrigatório."],
                "rules[2].delayMs": ["O atraso deve estar entre 0 e 120000 ms."],
                "rules[2].minAmount": ["O valor mínimo deve ser menor ou igual ao máximo."],
            });
            expect(await getRules(antifraudService)).toEqual(DEFAULT_RULES);
        });
    });
});
