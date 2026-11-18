/**
 * Regras do Antifraude (v1.0.0) — POST /rules
 *
 * Regra: 201 adiciona a regra no fim da lista, com Location /rules/{id} e todos os campos na resposta (padrões:
 * enabled true, decision Rejected, delivery Normal, submitFailures 0, demais null). id já existente (sem diferenciar
 * maiúsculas) → 409. Validação (R1–R7) → 400 com todos os erros em `errors` (chaves `rule.<campo>`); R11 → 400.
 * Em erro, a lista não muda.
 *
 * Estado: regras próprias com id único, escopadas por sourceAccountIds aleatório, removidas no fim.
 * Fora do escopo: efeito das condições nas análises (analysis-decision.spec.ts).
 */
import { randomUUID } from "node:crypto";
import { RuleBody } from "../../domains/antifraud/RuleBody";
import { expect, test } from "../../fixtures/ApiFixtures";
import { AntifraudInterface } from "../../interfaces/AntifraudInterface";
import { expectBadRequest, expectValidationProblem } from "../helpers/antifraud/problem";
import {
    buildRule,
    createRule,
    deleteCreatedRules,
    expectRuleAbsent,
    expectRuleCreated,
    invalidRuleBody,
    ruleIndex,
    trackRule,
    uniqueRuleId,
} from "../helpers/antifraud/rules";
import { expectProblem } from "../helpers/common/problem";

const MSG = {
    idRequired: "O id é obrigatório.",
    idLength: "O id deve ter no máximo 64 caracteres.",
    minNegative: "O valor mínimo não pode ser negativo.",
    maxNegative: "O valor máximo não pode ser negativo.",
    minGreater: "O valor mínimo deve ser menor ou igual ao máximo.",
    delay: "O atraso deve estar entre 0 e 120000 ms.",
    submitFailures: "As falhas de envio devem estar entre 0 e 20.",
} as const;

function idOfLength(length: number): string {
    const id = uniqueRuleId();
    return (id + "x".repeat(length)).slice(0, length);
}

test.describe("POST /rules", { tag: ["@antifraud", "@spec:regras-antifraude"] }, () => {
    test.afterEach(async ({ antifraudService }) => {
        await deleteCreatedRules(antifraudService);
    });

    async function expectAccepted(antifraudService: AntifraudInterface, body: RuleBody): Promise<void> {
        const res = await antifraudService.PostRule(body);
        trackRule(body.id!);
        expectRuleCreated(res, body);
    }

    test.describe("criação", () => {
        test("RUL-02: Regra só com id recebe os padrões e entra no fim da lista", async ({ antifraudService }) => {
            const first = await createRule(antifraudService);
            const body: RuleBody = { id: uniqueRuleId(), sourceAccountIds: [randomUUID()] };

            const rule = await test.step("cria a regra", async () => {
                const res = await antifraudService.PostRule(body);
                trackRule(body.id!);
                return expectRuleCreated(res, body);
            });

            await test.step("padrões preenchidos", async () => {
                expect(rule).toMatchObject({
                    enabled: true,
                    decision: "Rejected",
                    reason: null,
                    minAmount: null,
                    maxAmount: null,
                    destinationAccountIds: null,
                    descriptionContains: null,
                    delayMs: null,
                    delivery: "Normal",
                    submitFailures: 0,
                });
            });

            await test.step("GET /rules/{id} devolve a regra", async () => {
                const res = await antifraudService.GetRule(body.id!);
                expect(res.status, res.text).toBe(200);
                expect(res.body).toEqual(rule);
            });

            await test.step("adicionada depois das padrões e da regra criada antes", async () => {
                const firstIndex = await ruleIndex(antifraudService, first.id);
                const index = await ruleIndex(antifraudService, body.id!);
                expect(firstIndex).toBeGreaterThan(1);
                expect(index).toBeGreaterThan(firstIndex);
            });
        });

        test("RUL-03: Regra com todos os campos é devolvida como enviada", async ({ antifraudService }) => {
            const body: RuleBody = {
                id: uniqueRuleId(),
                enabled: false,
                decision: "Approved",
                reason: "Cliente confiável",
                minAmount: 10.5,
                maxAmount: 99.99,
                sourceAccountIds: [randomUUID(), randomUUID()],
                destinationAccountIds: [randomUUID()],
                descriptionContains: "Aluguel",
                delayMs: 1500,
                delivery: "Flip",
                submitFailures: 3,
            };

            const res = await antifraudService.PostRule(body);
            trackRule(body.id!);

            expectRuleCreated(res, body);
            expect((await antifraudService.GetRule(body.id!)).body).toEqual(res.body);
        });

        test("RUL-04: id já existente, sem diferenciar maiúsculas, responde 409 e não altera a regra", async ({ antifraudService }) => {
            const existing = await createRule(antifraudService, { reason: "Original" });

            for (const id of [existing.id, existing.id.toUpperCase()]) {
                await test.step(`POST com id ${id === existing.id ? "igual" : "em maiúsculas"}`, async () => {
                    const res = await antifraudService.PostRule(buildRule({ id, decision: "Approved", reason: "Outra" }));
                    expectProblem(res, 409, `Já existe uma regra com o id '${id}'.`);
                    expect(res.body).toMatchObject({ title: "Regra já existe." });
                });
            }

            await test.step("regra original intacta", async () => {
                expect((await antifraudService.GetRule(existing.id)).body).toEqual(existing);
            });
        });
    });

    test.describe("validação do corpo", () => {
        test("RUL-05: id ausente, vazio ou só espaços responde 400", async ({ antifraudService }) => {
            const variations = [
                { label: "ausente", body: invalidRuleBody({ sourceAccountIds: [randomUUID()] }) },
                { label: "vazio", body: buildRule({ id: "" }) },
                { label: "só espaços", body: buildRule({ id: "   " }) },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    expectValidationProblem(await antifraudService.PostRule(v.body), { "rule.id": [MSG.idRequired] });
                });
            }
        });

        test("RUL-06: id com 65 caracteres responde 400; 64 é aceito", async ({ antifraudService }) => {
            const tooLong = idOfLength(65);
            await test.step("65 caracteres", async () => {
                expectValidationProblem(await antifraudService.PostRule(buildRule({ id: tooLong })), { "rule.id": [MSG.idLength] });
                await expectRuleAbsent(antifraudService, tooLong);
            });

            await test.step("controle: 64 caracteres", async () => {
                await expectAccepted(antifraudService, buildRule({ id: idOfLength(64) }));
            });
        });

        test("RUL-07: minAmount e maxAmount negativos respondem 400; 0 é aceito", async ({ antifraudService }) => {
            const variations: { label: string, patch: RuleBody, errors: Record<string, string[]> }[] = [
                { label: "minAmount -0,01", patch: { minAmount: -0.01 }, errors: { "rule.minAmount": [MSG.minNegative] } },
                { label: "maxAmount -0,01", patch: { maxAmount: -0.01 }, errors: { "rule.maxAmount": [MSG.maxNegative] } },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    const body = buildRule(v.patch);
                    expectValidationProblem(await antifraudService.PostRule(body), v.errors);
                    await expectRuleAbsent(antifraudService, body.id!);
                });
            }

            await test.step("controle: minAmount 0 e maxAmount 0", async () => {
                await expectAccepted(antifraudService, buildRule({ minAmount: 0, maxAmount: 0 }));
            });
        });

        test("RUL-08: minAmount maior que maxAmount responde 400; minAmount igual a maxAmount é aceito", async ({ antifraudService }) => {
            const body = buildRule({ minAmount: 10, maxAmount: 9.99 });
            await test.step("minAmount 10 e maxAmount 9,99", async () => {
                expectValidationProblem(await antifraudService.PostRule(body), { "rule.minAmount": [MSG.minGreater] });
                await expectRuleAbsent(antifraudService, body.id!);
            });

            await test.step("controle: minAmount igual a maxAmount", async () => {
                await expectAccepted(antifraudService, buildRule({ minAmount: 10, maxAmount: 10 }));
            });
        });

        test("RUL-09: delayMs fora de 0 a 120000 responde 400; os limites são aceitos", async ({ antifraudService }) => {
            for (const delayMs of [-1, 120_001]) {
                await test.step(`delayMs ${delayMs}`, async () => {
                    const body = buildRule({ delayMs });
                    expectValidationProblem(await antifraudService.PostRule(body), { "rule.delayMs": [MSG.delay] });
                    await expectRuleAbsent(antifraudService, body.id!);
                });
            }

            for (const delayMs of [0, 12_001, 120_000]) {
                await test.step(`controle: delayMs ${delayMs}`, async () => {
                    await expectAccepted(antifraudService, buildRule({ delayMs }));
                });
            }
        });

        test("RUL-10: submitFailures fora de 0 a 20 responde 400; os limites são aceitos", async ({ antifraudService }) => {
            for (const submitFailures of [-1, 21]) {
                await test.step(`submitFailures ${submitFailures}`, async () => {
                    const body = buildRule({ submitFailures });
                    expectValidationProblem(await antifraudService.PostRule(body), { "rule.submitFailures": [MSG.submitFailures] });
                    await expectRuleAbsent(antifraudService, body.id!);
                });
            }

            for (const submitFailures of [0, 20]) {
                await test.step(`controle: submitFailures ${submitFailures}`, async () => {
                    await expectAccepted(antifraudService, buildRule({ submitFailures }));
                });
            }
        });

        test("RUL-11: Todos os erros de validação vêm juntos em errors", async ({ antifraudService }) => {
            const res = await antifraudService.PostRule(
                buildRule({ id: "", minAmount: -1, maxAmount: -2, delayMs: 120_001, submitFailures: 21 })
            );

            expectValidationProblem(res, {
                "rule.id": [MSG.idRequired],
                "rule.minAmount": [MSG.minNegative, MSG.minGreater],
                "rule.maxAmount": [MSG.maxNegative],
                "rule.delayMs": [MSG.delay],
                "rule.submitFailures": [MSG.submitFailures],
            });
        });

        test("RUL-12: decision ou delivery desconhecido e JSON malformado respondem 400", async ({ antifraudService }) => {
            const decision = buildRule();
            await test.step("decision desconhecido", async () => {
                expectBadRequest(await antifraudService.PostRule(invalidRuleBody({ ...decision, decision: "Maybe" })));
                await expectRuleAbsent(antifraudService, decision.id!);
            });

            const delivery = buildRule();
            await test.step("delivery desconhecido", async () => {
                expectBadRequest(await antifraudService.PostRule(invalidRuleBody({ ...delivery, delivery: "Pigeon" })));
                await expectRuleAbsent(antifraudService, delivery.id!);
            });

            const malformed = uniqueRuleId();
            await test.step("JSON malformado", async () => {
                expectBadRequest(await antifraudService.PostRuleRaw(`{"id":"${malformed}",`));
                await expectRuleAbsent(antifraudService, malformed);
            });
        });
    });
});
