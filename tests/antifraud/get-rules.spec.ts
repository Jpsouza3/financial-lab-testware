/**
 * Regras do Antifraude (v1.0.0) — GET /rules e GET /rules/{id}
 *
 * Regra: GET /rules lista as regras na ordem de avaliação, começando pelas de configuração (valor-alto,
 * destino-bloqueado). GET /rules/{id} não diferencia maiúsculas; id inexistente → 404 sem corpo.
 *
 * Estado: só lê as regras padrão e cria regras próprias (id único, escopadas por sourceAccountIds), removidas no fim.
 */
import { ContractValidator } from "../../core/schema/ContractValidator";
import { FraudRuleSchema } from "../../domains/antifraud/FraudRuleSchema";
import { expect, test } from "../../fixtures/ApiFixtures";
import { createRule, DEFAULT_RULES, deleteCreatedRules, getRules, uniqueRuleId } from "../helpers/antifraud/rules";

test.describe("GET /rules", { tag: ["@antifraud", "@spec:regras-antifraude"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await deleteCreatedRules(antifraudService);
    });

    test("RUL-01: Lista começa pelas regras de configuração, na ordem", async ({ antifraudService }) => {
        const rules = await getRules(antifraudService);

        expect(rules.slice(0, 2)).toEqual(DEFAULT_RULES);
    });

    test("RUL-13: GET /rules/{id} não diferencia maiúsculas e devolve 404 sem corpo para id inexistente", async ({ antifraudService }) => {
        const rule = await createRule(antifraudService, { reason: "Consulta por id" });

        await test.step("mesma grafia", async () => {
            const res = await antifraudService.GetRule(rule.id);
            expect(res.status, res.text).toBe(200);
            ContractValidator.validate(FraudRuleSchema, res.body);
            expect(res.body).toEqual(rule);
        });

        await test.step("id em maiúsculas", async () => {
            const res = await antifraudService.GetRule(rule.id.toUpperCase());
            expect(res.status, res.text).toBe(200);
            expect(res.body).toEqual(rule);
        });

        await test.step("regra padrão em maiúsculas", async () => {
            const res = await antifraudService.GetRule("VALOR-ALTO");
            expect(res.status, res.text).toBe(200);
            expect(res.body).toEqual(DEFAULT_RULES[0]);
        });

        await test.step("id inexistente", async () => {
            const res = await antifraudService.GetRule(uniqueRuleId());
            expect(res.status).toBe(404);
            expect(res.text).toBe("");
        });
    });
});
