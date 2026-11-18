/**
 * Análises do Antifraude (v1.0.0) — decisão por regras (POST /analyses + GET /analyses/{id})
 *
 * Regra: a análise fica Pending por delayMs (padrão 300 ms) e é decidida pela primeira regra habilitada cujas
 * condições informadas casam todas: minAmount (amount >= min), maxAmount (amount <= max), sourceAccountIds (origem),
 * destinationAccountIds (destino), descriptionContains (sem diferenciar maiúsculas; sem descrição não casa); lista
 * vazia ou null não filtra. Sem regra: Approved, reason e ruleId null. Rejected sem reason: "Recusada pela regra {id}.".
 * Approved: reason da regra (pode ser null) e ruleId preenchido.
 *
 * Estado: regras próprias com id único, escopadas por uma conta aleatória (ou token de descrição), removidas no fim.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "../../fixtures/ApiFixtures";
import {
    decide,
    DEFAULT_DELAY_MS,
    expectApprovedWithoutRule,
    expectRejectedBy,
    getAnalysis,
    submitAnalysis,
    waitForDecision,
} from "../helpers/antifraud/analyses";
import { BLOCKED_DESTINATION, createRule, DEFAULT_RULES, deleteCreatedRules } from "../helpers/antifraud/rules";

function elapsedMs(analysis: { createdAt: string, decidedAt: string | null }): number {
    return Date.parse(analysis.decidedAt!) - Date.parse(analysis.createdAt);
}

test.describe("Decisão da análise", { tag: ["@antifraud", "@spec:analises-antifraude"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await deleteCreatedRules(antifraudService);
    });

    test.describe("resultado", () => {
        test("ANL-02: Sem regra que case, aprova sem reason nem ruleId depois do atraso padrão", async ({ antifraudService }) => {
            const decided = await decide(antifraudService, { amount: 10 });

            expectApprovedWithoutRule(decided);
            expect(decided.webhook.mode).toBe("Normal");
            expect(decided.decidedAt).toMatch(/Z$/);
            expect(elapsedMs(decided)).toBeGreaterThanOrEqual(DEFAULT_DELAY_MS - 10);
        });

        test("ANL-11: Regra Rejected usa a reason da regra ou \"Recusada pela regra {id}.\"", async ({ antifraudService }) => {
            const withReason = randomUUID();
            const withoutReason = randomUUID();
            const ruleWithReason = await createRule(antifraudService, { sourceAccountIds: [withReason], reason: "Origem suspeita" });
            const ruleWithoutReason = await createRule(antifraudService, { sourceAccountIds: [withoutReason] });

            const [a, b] = await Promise.all([
                decide(antifraudService, { sourceAccountId: withReason }),
                decide(antifraudService, { sourceAccountId: withoutReason }),
            ]);

            expectRejectedBy(a, ruleWithReason.id, "Origem suspeita");
            expectRejectedBy(b, ruleWithoutReason.id, `Recusada pela regra ${ruleWithoutReason.id}.`);
        });

        test("ANL-12: Regra Approved preenche ruleId e usa a reason da regra, que pode ser null", async ({ antifraudService }) => {
            const withReason = randomUUID();
            const withoutReason = randomUUID();
            const ruleWithReason = await createRule(antifraudService, { sourceAccountIds: [withReason], decision: "Approved", reason: "Cliente VIP" });
            const ruleWithoutReason = await createRule(antifraudService, { sourceAccountIds: [withoutReason], decision: "Approved" });

            const [a, b] = await Promise.all([
                decide(antifraudService, { sourceAccountId: withReason }),
                decide(antifraudService, { sourceAccountId: withoutReason }),
            ]);

            expect(a).toMatchObject({ status: "Approved", ruleId: ruleWithReason.id, reason: "Cliente VIP" });
            expect(b).toMatchObject({ status: "Approved", ruleId: ruleWithoutReason.id, reason: null });
        });

        test("ANL-23: Fica Pending durante delayMs e decide depois dele", async ({ antifraudService }) => {
            test.setTimeout(60_000);
            const slow = randomUUID();
            const fast = randomUUID();
            const slowRule = await createRule(antifraudService, { sourceAccountIds: [slow], delayMs: 2_000 });
            await createRule(antifraudService, { sourceAccountIds: [fast], decision: "Approved", delayMs: 0 });

            const submitted = await submitAnalysis(antifraudService, { sourceAccountId: slow });

            await test.step("ainda Pending sem reason, ruleId nem decidedAt", async () => {
                const pending = await getAnalysis(antifraudService, submitted.id);
                expect(pending).toMatchObject({ status: "Pending", reason: null, ruleId: null, decidedAt: null });
                expect(pending.webhook).toMatchObject({ status: "Pending", attempts: [] });
            });

            await test.step("decide depois de delayMs", async () => {
                const decided = await waitForDecision(antifraudService, submitted.id);
                expectRejectedBy(decided, slowRule.id);
                expect(elapsedMs(decided)).toBeGreaterThanOrEqual(1_990);
            });

            await test.step("delayMs 0 decide antes do atraso padrão", async () => {
                const decided = await decide(antifraudService, { sourceAccountId: fast });
                expect(elapsedMs(decided)).toBeLessThan(DEFAULT_DELAY_MS);
            });
        });
    });

    test.describe("condições da regra", () => {
        test("ANL-13: minAmount casa a partir do valor exato", async ({ antifraudService }) => {
            const source = randomUUID();
            const rule = await createRule(antifraudService, { sourceAccountIds: [source], minAmount: 50 });

            const [equal, above, below] = await Promise.all([
                decide(antifraudService, { sourceAccountId: source, amount: 50 }),
                decide(antifraudService, { sourceAccountId: source, amount: 50.01 }),
                decide(antifraudService, { sourceAccountId: source, amount: 49.99 }),
            ]);

            expectRejectedBy(equal, rule.id);
            expectRejectedBy(above, rule.id);
            expectApprovedWithoutRule(below);
        });

        test("ANL-14: maxAmount casa até o valor exato", async ({ antifraudService }) => {
            const source = randomUUID();
            const rule = await createRule(antifraudService, { sourceAccountIds: [source], maxAmount: 50 });

            const [equal, below, above] = await Promise.all([
                decide(antifraudService, { sourceAccountId: source, amount: 50 }),
                decide(antifraudService, { sourceAccountId: source, amount: 0.01 }),
                decide(antifraudService, { sourceAccountId: source, amount: 50.01 }),
            ]);

            expectRejectedBy(equal, rule.id);
            expectRejectedBy(below, rule.id);
            expectApprovedWithoutRule(above);
        });

        test("ANL-15: minAmount igual a maxAmount casa só o valor exato", async ({ antifraudService }) => {
            const source = randomUUID();
            const rule = await createRule(antifraudService, { sourceAccountIds: [source], minAmount: 25.5, maxAmount: 25.5 });

            const [exact, below, above] = await Promise.all([
                decide(antifraudService, { sourceAccountId: source, amount: 25.5 }),
                decide(antifraudService, { sourceAccountId: source, amount: 25.49 }),
                decide(antifraudService, { sourceAccountId: source, amount: 25.51 }),
            ]);

            expectRejectedBy(exact, rule.id);
            expectApprovedWithoutRule(below);
            expectApprovedWithoutRule(above);
        });

        test("ANL-16: descriptionContains não diferencia maiúsculas e não casa sem descrição", async ({ antifraudService }) => {
            const source = randomUUID();
            const token = `Tok${randomUUID().slice(0, 8)}`;
            const rule = await createRule(antifraudService, { sourceAccountIds: [source], descriptionContains: token });

            const variations = [
                { label: "mesma grafia", description: `pagamento ${token}`, matches: true },
                { label: "minúsculas no meio do texto", description: `ref-${token.toLowerCase()}-final`, matches: true },
                { label: "maiúsculas", description: token.toUpperCase(), matches: true },
                { label: "texto sem o token", description: "pagamento comum", matches: false },
                { label: "sem descrição", description: null, matches: false },
            ];
            const results = await Promise.all(
                variations.map((v) => decide(antifraudService, { sourceAccountId: source, description: v.description }))
            );

            variations.forEach((v, i) => {
                if (v.matches) expectRejectedBy(results[i], rule.id);
                else expectApprovedWithoutRule(results[i]);
                expect(results[i].description, v.label).toBe(v.description);
            });
        });

        test("ANL-17: Regra desabilitada nunca casa", async ({ antifraudService }) => {
            const source = randomUUID();
            await createRule(antifraudService, { sourceAccountIds: [source], enabled: false });
            expect(DEFAULT_RULES[1]).toMatchObject({ enabled: false, destinationAccountIds: [BLOCKED_DESTINATION] });

            const [own, blockedDefault] = await Promise.all([
                decide(antifraudService, { sourceAccountId: source }),
                decide(antifraudService, { destinationAccountId: BLOCKED_DESTINATION }),
            ]);

            expectApprovedWithoutRule(own);
            expectApprovedWithoutRule(blockedDefault);
        });

        test("ANL-18: sourceAccountIds filtra pela conta de origem, não pela de destino", async ({ antifraudService }) => {
            const account = randomUUID();
            const rule = await createRule(antifraudService, { sourceAccountIds: [randomUUID(), account] });

            const [asSource, asDestination] = await Promise.all([
                decide(antifraudService, { sourceAccountId: account }),
                decide(antifraudService, { destinationAccountId: account }),
            ]);

            expectRejectedBy(asSource, rule.id);
            expectApprovedWithoutRule(asDestination);
        });

        test("ANL-19: destinationAccountIds filtra pela conta de destino, não pela de origem", async ({ antifraudService }) => {
            const account = randomUUID();
            const rule = await createRule(antifraudService, { sourceAccountIds: null, destinationAccountIds: [account] });

            const [asDestination, asSource] = await Promise.all([
                decide(antifraudService, { destinationAccountId: account }),
                decide(antifraudService, { sourceAccountId: account }),
            ]);

            expectRejectedBy(asDestination, rule.id);
            expectApprovedWithoutRule(asSource);
        });

        test("ANL-20: Listas de contas vazias não filtram", async ({ antifraudService }) => {
            const token = `Tok${randomUUID().slice(0, 8)}`;
            const rule = await createRule(antifraudService, {
                sourceAccountIds: [],
                destinationAccountIds: [],
                descriptionContains: token,
            });

            const decided = await decide(antifraudService, { description: `pix ${token}` });

            expectRejectedBy(decided, rule.id);
        });

        test("ANL-21: A primeira regra habilitada que casa decide", async ({ antifraudService }) => {
            const source = randomUUID();
            const narrow = await createRule(antifraudService, { sourceAccountIds: [source], decision: "Approved", reason: "Primeira", maxAmount: 5 });
            const broad = await createRule(antifraudService, { sourceAccountIds: [source], reason: "Segunda" });

            const [both, onlySecond] = await Promise.all([
                decide(antifraudService, { sourceAccountId: source, amount: 5 }),
                decide(antifraudService, { sourceAccountId: source, amount: 6 }),
            ]);

            expect(both).toMatchObject({ status: "Approved", ruleId: narrow.id, reason: "Primeira" });
            expectRejectedBy(onlySecond, broad.id, "Segunda");
        });

        test("ANL-22: Regra padrão valor-alto recusa a partir de 1000,00", async ({ antifraudService }) => {
            const [limit, below] = await Promise.all([
                decide(antifraudService, { amount: 1_000 }),
                decide(antifraudService, { amount: 999.99 }),
            ]);

            expectRejectedBy(limit, "valor-alto", "Valor acima do limite de risco.");
            expectApprovedWithoutRule(below);
        });
    });
});
