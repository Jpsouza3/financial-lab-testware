/**
 * Regras do Antifraude (v1.0.0) — DELETE /rules/{id}
 *
 * Regra: 204 remove a regra (id sem diferenciar maiúsculas); id inexistente → 404 sem corpo. Regra removida deixa de
 * decidir análises novas.
 *
 * Estado: regras próprias com id único, escopadas por sourceAccountIds aleatório.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "../../fixtures/ApiFixtures";
import { decide, expectApprovedWithoutRule } from "../helpers/antifraud/analyses";
import { createRule, deleteCreatedRules, expectRuleAbsent, getRules, uniqueRuleId } from "../helpers/antifraud/rules";

test.describe("DELETE /rules/{id}", { tag: ["@antifraud", "@spec:regras-antifraude"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await deleteCreatedRules(antifraudService);
    });

    test("RUL-18: Remove a regra sem diferenciar maiúsculas e responde 404 para id inexistente", async ({ antifraudService }) => {
        const source = randomUUID();
        const rule = await createRule(antifraudService, { sourceAccountIds: [source] });

        await test.step("remove com o id em maiúsculas", async () => {
            const res = await antifraudService.DeleteRule(rule.id.toUpperCase());
            expect(res.status, res.text).toBe(204);
            expect(res.text).toBe("");
        });

        await test.step("regra sumiu da consulta e da lista", async () => {
            await expectRuleAbsent(antifraudService, rule.id);
            expect((await getRules(antifraudService)).map((r) => r.id)).not.toContain(rule.id);
        });

        await test.step("remover de novo responde 404 sem corpo", async () => {
            const res = await antifraudService.DeleteRule(rule.id);
            expect(res.status).toBe(404);
            expect(res.text).toBe("");
        });

        await test.step("id que nunca existiu responde 404", async () => {
            expect((await antifraudService.DeleteRule(uniqueRuleId())).status).toBe(404);
        });

        await test.step("análise nova da origem escopada não casa mais", async () => {
            expectApprovedWithoutRule(await decide(antifraudService, { sourceAccountId: source }));
        });
    });
});
