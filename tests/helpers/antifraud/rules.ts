import { randomUUID } from "node:crypto";
import { HttpResponse } from "../../../core/http/HttpResponse";
import { ContractValidator } from "../../../core/schema/ContractValidator";
import { FraudRule } from "../../../domains/antifraud/FraudRule";
import { FraudRuleListSchema, FraudRuleSchema } from "../../../domains/antifraud/FraudRuleSchema";
import { RuleBody } from "../../../domains/antifraud/RuleBody";
import { expect } from "../../../fixtures/ApiFixtures";
import { AntifraudInterface } from "../../../interfaces/AntifraudInterface";

export const DEFAULT_RULES: FraudRule[] = [
    {
        id: "valor-alto",
        enabled: true,
        decision: "Rejected",
        reason: "Valor acima do limite de risco.",
        minAmount: 1000,
        maxAmount: null,
        sourceAccountIds: null,
        destinationAccountIds: null,
        descriptionContains: null,
        delayMs: null,
        delivery: "Normal",
        submitFailures: 0,
    },
    {
        id: "destino-bloqueado",
        enabled: false,
        decision: "Rejected",
        reason: "Conta de destino em lista restritiva.",
        minAmount: null,
        maxAmount: null,
        sourceAccountIds: null,
        destinationAccountIds: ["33333333-3333-3333-3333-333333333333"],
        descriptionContains: null,
        delayMs: null,
        delivery: "Normal",
        submitFailures: 0,
    },
];

export const BLOCKED_DESTINATION = "33333333-3333-3333-3333-333333333333";

const RULE_DEFAULTS: Omit<FraudRule, "id"> = {
    enabled: true,
    decision: "Rejected",
    reason: null,
    minAmount: null,
    maxAmount: null,
    sourceAccountIds: null,
    destinationAccountIds: null,
    descriptionContains: null,
    delayMs: null,
    delivery: "Normal",
    submitFailures: 0,
};

const createdRuleIds = new Set<string>();

export function uniqueRuleId(): string {
    return `af-${randomUUID()}`;
}

export function trackRule(id: string): void {
    createdRuleIds.add(id);
}

export function buildRule(overrides: RuleBody = {}): RuleBody {
    return { id: uniqueRuleId(), sourceAccountIds: [randomUUID()], ...overrides };
}

export function invalidRuleBody(body: Record<string, unknown>): RuleBody {
    return body as unknown as RuleBody;
}

export function expectedRule(body: RuleBody): FraudRule {
    return { ...RULE_DEFAULTS, ...body } as FraudRule;
}

export function expectRuleCreated(res: HttpResponse<FraudRule>, body: RuleBody): FraudRule {
    expect(res.status, res.text).toBe(201);
    ContractValidator.validate(FraudRuleSchema, res.body);
    expect(res.headers["location"]).toBe(`/rules/${body.id}`);
    expect(res.body).toEqual(expectedRule(body));
    return res.body;
}

export async function createRule(antifraudService: AntifraudInterface, overrides: RuleBody = {}): Promise<FraudRule> {
    const body = buildRule(overrides);
    const res = await antifraudService.PostRule(body);
    expect(res.status, `POST /rules ${body.id}: ${res.text}`).toBe(201);
    trackRule(body.id!);
    ContractValidator.validate(FraudRuleSchema, res.body);
    return res.body;
}

export async function deleteCreatedRules(antifraudService: AntifraudInterface): Promise<void> {
    for (const id of createdRuleIds) await antifraudService.DeleteRule(id);
    createdRuleIds.clear();
}

export async function getRules(antifraudService: AntifraudInterface): Promise<FraudRule[]> {
    const res = await antifraudService.GetRules();
    expect(res.status, res.text).toBe(200);
    ContractValidator.validate(FraudRuleListSchema, res.body);
    return res.body;
}

export async function ruleIndex(antifraudService: AntifraudInterface, id: string): Promise<number> {
    return (await getRules(antifraudService)).findIndex((r) => r.id.toLowerCase() === id.toLowerCase());
}

export async function expectRuleAbsent(antifraudService: AntifraudInterface, id: string): Promise<void> {
    const res = await antifraudService.GetRule(id);
    expect(res.status, res.text).toBe(404);
}

export async function resetRules(antifraudService: AntifraudInterface): Promise<void> {
    const res = await antifraudService.ResetRules();
    expect(res.status, `POST /rules/reset: ${res.text}`).toBe(200);
}
