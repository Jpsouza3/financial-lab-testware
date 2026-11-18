import { randomUUID } from "node:crypto";
import { ContractValidator } from "../../../core/schema/ContractValidator";
import { FraudRule } from "../../../domains/antifraud/FraudRule";
import { FraudRuleSchema } from "../../../domains/antifraud/FraudRuleSchema";
import { RuleBody } from "../../../domains/antifraud/RuleBody";
import { expect } from "../../../fixtures/ApiFixtures";
import { AntifraudInterface } from "../../../interfaces/AntifraudInterface";

/**
 * Regras do antifraude criadas pelo teste.
 *
 * A lista de regras é global e compartilhada com testes paralelos: cada regra tem `id` único, vale só para a
 * conta de origem recém-aberta (`sourceAccountIds`), fica abaixo de `1000.00` (a regra padrão `valor-alto` vem
 * antes) e é removida no `afterEach` por `RuleScope.cleanup`.
 */

export const MAX_RULE_AMOUNT = 999.99;

export type ScopedRule = Omit<RuleBody, "id" | "sourceAccountIds" | "maxAmount">;

export class RuleScope {
    private readonly ids: string[] = [];

    async create(antifraudService: AntifraudInterface, sourceAccountId: string, rule: ScopedRule): Promise<FraudRule> {
        const body: RuleBody = {
            id: `e2e-${randomUUID()}`,
            enabled: true,
            maxAmount: MAX_RULE_AMOUNT,
            ...rule,
            sourceAccountIds: [sourceAccountId],
        };
        const res = await antifraudService.PostRule(body);
        expect(res.status, `POST /rules: ${res.text}`).toBe(201);
        ContractValidator.validate(FraudRuleSchema, res.body);
        this.ids.push(res.body.id);
        return res.body;
    }

    async cleanup(antifraudService: AntifraudInterface): Promise<void> {
        for (const id of this.ids.splice(0)) {
            const res = await antifraudService.DeleteRule(id);
            expect([204, 404], `DELETE /rules/${id}: ${res.text}`).toContain(res.status);
        }
    }
}
