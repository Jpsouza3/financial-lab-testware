/**
 * Criar Bloqueio de Saldo (v1.0.0) — POST /accounts/{accountId}/holds
 *
 * Regra: 201 cria o bloqueio Active e move `amount` de availableBalance para blockedBalance (balance não muda,
 * version + 1). Repetir a mesma reference com o mesmo amount devolve 200 com o bloqueio original (no estado atual);
 * com outro amount, 409. Demais regras, avaliadas na ordem: corpo inválido (400), conta inexistente (404),
 * reference já usada (R7), conta Closed (422), limite de 5 bloqueios Active (422), saldo disponível insuficiente (422).
 *
 * Contas: cada teste que muta saldo usa um slot próprio de ACTIVE_ACCOUNT_IDS (ver tests/helpers/account/holds.ts).
 * Os bloqueios criados não são liberados: cada execução precisa de contas limpas.
 * Fora do escopo (v1.0.0): repetição de bloqueio Released (HLD-15a), Released no limite (HLD-19),
 * não-efeito no extrato (HLD-01/02) e HLD-22 com conta Closed + reference já usada.
 */
import { randomUUID } from "node:crypto";
import { ContractValidator } from "../../core/schema/ContractValidator";
import { HoldResponseSchema } from "../../domains/account/HoldResponseSchema";
import { expect, test } from "../../fixtures/ApiFixtures";
import {
    activeAccount,
    blockedAccount,
    buildHoldBody,
    cents,
    closedAccount,
    createHold,
    expectBalanceAfterHold,
    expectBalanceUnchanged,
    expectHoldCreated,
    fillActiveHolds,
    getBalance,
    invalidHoldBody,
    isoIn,
    requireAvailable,
    uniqueReference,
    waitForHoldStatus,
    waitForTransferFinal,
} from "../helpers/account/holds";
import { expectProblem } from "../helpers/common/problem";

/** Slot de ACTIVE_ACCOUNT_IDS usado por cada teste (uma conta por teste que muta saldo). */
const SLOT = {
    HLD01: 0, HLD02: 1, HLD03: 2, HLD05: 3, HLD06_A: 4, HLD06_B: 5,
    HLD07: 6, HLD08: 7, HLD09: 8, HLD10: 9, HLD11: 10,
    HLD13: 11, HLD14: 12, HLD15: 13, HLD16: 14, HLD18: 15, HLD19: 16, HLD20: 17,
    HLD21_SRC: 18, HLD21_DST: 19, HLD22: 20,
} as const;

const DETAIL = {
    reference: "A referência deve ter de 1 a 32 caracteres alfanuméricos, hífen ou sublinhado.",
    amount: "O valor deve ser maior que zero.",
    decimals: "O valor deve ter no máximo 2 casas decimais.",
    reason: "O motivo deve ter entre 5 e 200 caracteres.",
    expiresAt: "A expiração deve estar entre 10 segundos e 90 dias a partir de agora.",
    accountNotFound: "Conta não encontrada.",
    holdNotFound: "Bloqueio não encontrado.",
    referenceConflict: "Referência já utilizada com outro valor.",
    closed: "Conta encerrada não aceita bloqueio de saldo.",
    limit: "Limite de 5 bloqueios ativos atingido.",
    insufficient: "Saldo disponível insuficiente para o bloqueio.",
} as const;

const DAY = 24 * 60 * 60 * 1000;

test.describe("POST /accounts/{accountId}/holds", () => {
    test.describe("criação", () => {
        test("HLD-01: Criar bloqueio sem expiração em conta Active com saldo", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD01);
            const before = await getBalance(accountService, accountId);
            requireAvailable(before, 1);
            const body = buildHoldBody({ amount: 1.0 });

            const hold = await test.step("cria o bloqueio", async () => {
                const res = await accountService.PostHold(accountId, body);
                const created = expectHoldCreated(res, body, accountId);
                expect(created.expiresAt).toBeNull();
                return created;
            });

            await test.step("saldo: blockedBalance + amount, availableBalance − amount, version + 1", async () => {
                expectBalanceAfterHold(before, await getBalance(accountService, accountId), body.amount);
            });

            await test.step("consulta e listagem devolvem o bloqueio", async () => {
                const get = await accountService.GetHold(accountId, hold.holdId);
                expect(get.status).toBe(200);
                expect(get.body).toEqual(hold);
                const list = await accountService.GetHolds(accountId, "Active");
                expect(list.status).toBe(200);
                expect(list.body.map((h) => h.holdId)).toContain(hold.holdId);
            });
        });

        test("HLD-02: Criar bloqueio com expiresAt válido", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD02);
            requireAvailable(await getBalance(accountService, accountId), 0.04);

            const variations = [
                { label: "+1 h em UTC", expiresAt: isoIn(60 * 60 * 1000) },
                { label: "+1 h com -03:00", expiresAt: isoIn(60 * 60 * 1000, -180) },
                { label: "+89 dias", expiresAt: isoIn(89 * DAY) },
                { label: "+30 s", expiresAt: isoIn(30_000) },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    const body = buildHoldBody({ amount: 0.01, expiresAt: v.expiresAt });
                    const hold = expectHoldCreated(await accountService.PostHold(accountId, body), body, accountId);
                    expect(hold.expiresAt).toMatch(/Z$/);
                    expect(Math.abs(Date.parse(hold.expiresAt!) - Date.parse(v.expiresAt))).toBeLessThan(1_000);
                });
            }
        });

        test("HLD-03: Bloqueio com amount igual ao availableBalance zera o disponível", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD03);
            const before = await getBalance(accountService, accountId);
            requireAvailable(before, 0.01);
            const body = buildHoldBody({ amount: before.availableBalance });

            expectHoldCreated(await accountService.PostHold(accountId, body), body, accountId);

            const after = await getBalance(accountService, accountId);
            expectBalanceAfterHold(before, after, body.amount);
            expect(after.availableBalance).toBeCloseTo(0, 2);
        });

        test("HLD-04: Conta Blocked aceita bloqueio de saldo", async ({ accountService }) => {
            const accountId = blockedAccount();
            const before = await getBalance(accountService, accountId);
            expect(before.status).toBe("Blocked");
            requireAvailable(before, 0.01);
            const body = buildHoldBody({ amount: 0.01 });

            expectHoldCreated(await accountService.PostHold(accountId, body), body, accountId);

            const after = await getBalance(accountService, accountId);
            expect(after.status).toBe("Blocked");
            expectBalanceAfterHold(before, after, body.amount);
        });

        test("HLD-05: reason com espaços nas pontas é gravado sem eles", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD05);
            requireAvailable(await getBalance(accountService, accountId), 0.01);
            const body = buildHoldBody({ amount: 0.01, reason: "   Ordem judicial 123   " });

            const hold = expectHoldCreated(await accountService.PostHold(accountId, body), body, accountId);
            expect(hold.reason).toBe("Ordem judicial 123");
            expect((await accountService.GetHold(accountId, hold.holdId)).body.reason).toBe("Ordem judicial 123");
        });

        test("HLD-06: Mesma reference em outra conta cria outro bloqueio", async ({ accountService }) => {
            const accountA = activeAccount(SLOT.HLD06_A);
            const accountB = activeAccount(SLOT.HLD06_B);
            requireAvailable(await getBalance(accountService, accountA), 0.02);
            requireAvailable(await getBalance(accountService, accountB), 0.03);

            const sameAmount = await createHold(accountService, accountA, { amount: 0.01 });
            const otherAmount = await createHold(accountService, accountA, { amount: 0.01 });
            const balanceA = await getBalance(accountService, accountA);
            const holdsA = (await accountService.GetHolds(accountA)).body;

            const holdB = await test.step("mesma reference e mesmo amount na conta B", async () => {
                const body = buildHoldBody({ reference: sameAmount.reference, amount: 0.01 });
                const hold = expectHoldCreated(await accountService.PostHold(accountB, body), body, accountB);
                expect(hold.holdId).not.toBe(sameAmount.holdId);
                return hold;
            });

            await test.step("mesma reference e outro amount na conta B", async () => {
                const body = buildHoldBody({ reference: otherAmount.reference, amount: 0.02 });
                const hold = expectHoldCreated(await accountService.PostHold(accountB, body), body, accountB);
                expect(hold.holdId).not.toBe(otherAmount.holdId);
            });

            await test.step("conta A não muda e não enxerga o bloqueio de B", async () => {
                expectBalanceUnchanged(balanceA, await getBalance(accountService, accountA));
                expect((await accountService.GetHolds(accountA)).body).toEqual(holdsA);
                expectProblem(await accountService.GetHold(accountA, holdB.holdId), 404, DETAIL.holdNotFound);
            });
        });
    });

    test.describe("validação do corpo", () => {
        test("HLD-07: reference inválida", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD07);
            const before = await getBalance(accountService, accountId);
            requireAvailable(before, 0.02);

            const invalid: { label: string; reference?: string }[] = [
                { label: "ausente" },
                { label: "vazia", reference: "" },
                { label: "33 caracteres", reference: "a".repeat(33) },
                { label: "com espaço", reference: "ab cd" },
                { label: "com acento", reference: "referência" },
                { label: "com ponto", reference: "a.b" },
                { label: "com arroba", reference: "a@b" },
                { label: "com barra", reference: "a/b" },
            ];
            for (const v of invalid) {
                await test.step(`400: ${v.label}`, async () => {
                    const { reference: _omit, ...rest } = buildHoldBody({ amount: 0.01 });
                    const body = invalidHoldBody(v.reference === undefined ? rest : { ...rest, reference: v.reference });
                    expectProblem(await accountService.PostHold(accountId, body), 400, DETAIL.reference);
                });
            }
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));

            for (const reference of [uniqueReference("r").slice(0, 1), uniqueReference().padEnd(32, "x").slice(0, 32)]) {
                await test.step(`controle 201: reference com ${reference.length} caractere(s)`, async () => {
                    const body = buildHoldBody({ reference, amount: 0.01 });
                    expectHoldCreated(await accountService.PostHold(accountId, body), body, accountId);
                });
            }
        });

        test("HLD-08: amount ausente, zero ou negativo", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD08);
            const before = await getBalance(accountService, accountId);
            requireAvailable(before, 0.01);

            const invalid: { label: string; amount?: number }[] = [
                { label: "ausente" },
                { label: "zero", amount: 0 },
                { label: "-0,01", amount: -0.01 },
                { label: "-100", amount: -100 },
            ];
            for (const v of invalid) {
                await test.step(`400: ${v.label}`, async () => {
                    const { amount: _omit, ...rest } = buildHoldBody();
                    const body = invalidHoldBody(v.amount === undefined ? rest : { ...rest, amount: v.amount });
                    expectProblem(await accountService.PostHold(accountId, body), 400, DETAIL.amount);
                });
            }
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));

            await test.step("controle 201: 0,01", async () => {
                const body = buildHoldBody({ amount: 0.01 });
                expectHoldCreated(await accountService.PostHold(accountId, body), body, accountId);
            });
        });

        test("HLD-09: amount com mais de 2 casas decimais", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD09);
            const before = await getBalance(accountService, accountId);
            requireAvailable(before, 20.11);

            for (const amount of [10.001, 0.001]) {
                await test.step(`400: ${amount}`, async () => {
                    expectProblem(await accountService.PostHold(accountId, buildHoldBody({ amount })), 400, DETAIL.decimals);
                });
            }
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));

            for (const amount of [10.01, 10.1]) {
                await test.step(`controle 201: ${amount}`, async () => {
                    const body = buildHoldBody({ amount });
                    expectHoldCreated(await accountService.PostHold(accountId, body), body, accountId);
                });
            }
        });

        test("HLD-10: reason ausente ou fora de 5 a 200 caracteres", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD10);
            const before = await getBalance(accountService, accountId);
            requireAvailable(before, 0.02);

            const invalid: { label: string; reason?: string }[] = [
                { label: "ausente" },
                { label: "vazio", reason: "" },
                { label: "4 caracteres", reason: "abcd" },
                { label: "201 caracteres", reason: "a".repeat(201) },
            ];
            for (const v of invalid) {
                await test.step(`400: ${v.label}`, async () => {
                    const { reason: _omit, ...rest } = buildHoldBody({ amount: 0.01 });
                    const body = invalidHoldBody(v.reason === undefined ? rest : { ...rest, reason: v.reason });
                    expectProblem(await accountService.PostHold(accountId, body), 400, DETAIL.reason);
                });
            }
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));

            for (const reason of ["a".repeat(5), "a".repeat(200)]) {
                await test.step(`controle 201: ${reason.length} caracteres`, async () => {
                    const body = buildHoldBody({ amount: 0.01, reason });
                    expectHoldCreated(await accountService.PostHold(accountId, body), body, accountId);
                });
            }
        });

        // A spec não diz se o tamanho do reason é medido antes ou depois do trim (questão em aberto 1 do handoff).
        test.fixme("HLD-10: reason \"   abc   \" (3 caracteres após o trim)", async () => {});

        test("HLD-11: expiresAt fora da janela de 10 s a 90 dias", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD11);
            const before = await getBalance(accountService, accountId);

            const invalid = [
                { label: "no passado", expiresAt: () => isoIn(-60_000) },
                { label: "agora", expiresAt: () => isoIn(0) },
                { label: "+5 s", expiresAt: () => isoIn(5_000) },
                { label: "+91 dias", expiresAt: () => isoIn(91 * DAY) },
            ];
            for (const v of invalid) {
                await test.step(`400: ${v.label}`, async () => {
                    const body = buildHoldBody({ amount: 0.01, expiresAt: v.expiresAt() });
                    expectProblem(await accountService.PostHold(accountId, body), 400, DETAIL.expiresAt);
                });
            }
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });

        test("HLD-12: Conta inexistente", async ({ accountService }) => {
            const res = await accountService.PostHold(randomUUID(), buildHoldBody({ amount: 0.01 }));
            expectProblem(res, 404, DETAIL.accountNotFound);
        });
    });

    test.describe("idempotência", () => {
        test("HLD-13: Repetição com mesma reference e mesmo amount devolve o bloqueio original", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD13);
            requireAvailable(await getBalance(accountService, accountId), 0.01);
            const original = await createHold(accountService, accountId, {
                amount: 0.01,
                reason: "Motivo original",
                expiresAt: isoIn(DAY),
            });
            const before = await getBalance(accountService, accountId);

            const res = await accountService.PostHold(accountId, buildHoldBody({
                reference: original.reference,
                amount: 0.01,
                reason: "Motivo diferente",
                expiresAt: isoIn(2 * DAY),
            }));

            expect(res.status).toBe(200);
            ContractValidator.validate(HoldResponseSchema, res.body);
            expect(res.body).toEqual(original);
            const sameReference = (await accountService.GetHolds(accountId)).body.filter((h) => h.reference === original.reference);
            expect(sameReference).toHaveLength(1);
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });

        test("HLD-14: Repetição devolve 200 mesmo sem saldo disponível agora", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD14);
            requireAvailable(await getBalance(accountService, accountId), 0.02);
            const original = await createHold(accountService, accountId, { amount: 0.01 });
            const remaining = (await getBalance(accountService, accountId)).availableBalance;
            await createHold(accountService, accountId, { amount: remaining });
            const before = await getBalance(accountService, accountId);
            expect(before.availableBalance).toBeCloseTo(0, 2);

            const res = await accountService.PostHold(accountId, buildHoldBody({ reference: original.reference, amount: 0.01 }));

            expect(res.status).toBe(200);
            expect(res.body).toEqual(original);
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });

        test("HLD-15: Repetição devolve o bloqueio no estado atual (Expired)", async ({ accountService }) => {
            test.setTimeout(90_000);
            const accountId = activeAccount(SLOT.HLD15);
            requireAvailable(await getBalance(accountService, accountId), 0.01);
            const original = await createHold(accountService, accountId, { amount: 0.01, expiresAt: isoIn(15_000) });

            await test.step("aguarda a expiração", async () => {
                await waitForHoldStatus(accountService, accountId, original.holdId, "Expired", 60_000);
            });
            const before = await getBalance(accountService, accountId);

            const res = await accountService.PostHold(accountId, buildHoldBody({ reference: original.reference, amount: 0.01 }));

            expect(res.status).toBe(200);
            ContractValidator.validate(HoldResponseSchema, res.body);
            expect(res.body).toMatchObject({ holdId: original.holdId, status: "Expired" });
            expect(res.body.releasedAt).not.toBeNull();
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });

        test("HLD-16: reference já usada com outro amount", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD16);
            requireAvailable(await getBalance(accountService, accountId), 0.03);
            const original = await createHold(accountService, accountId, { amount: 0.01 });
            const before = await getBalance(accountService, accountId);

            const res = await accountService.PostHold(accountId, buildHoldBody({ reference: original.reference, amount: 0.02 }));

            expectProblem(res, 409, DETAIL.referenceConflict);
            expect((await accountService.GetHold(accountId, original.holdId)).body).toEqual(original);
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });
    });

    test.describe("regras de negócio", () => {
        test("HLD-17: Conta Closed não aceita bloqueio", async ({ accountService }) => {
            const accountId = closedAccount();
            const before = await getBalance(accountService, accountId);
            expect(before.status).toBe("Closed");

            expectProblem(await accountService.PostHold(accountId, buildHoldBody({ amount: 0.01 })), 422, DETAIL.closed);
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });

        test("HLD-18: Limite de 5 bloqueios Active", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD18);
            requireAvailable(await getBalance(accountService, accountId), 0.06);
            await fillActiveHolds(accountService, accountId, 4);

            await test.step("5º bloqueio é aceito", async () => {
                await createHold(accountService, accountId, { amount: 0.01 });
            });

            await test.step("6º bloqueio é recusado", async () => {
                const before = await getBalance(accountService, accountId);
                expectProblem(await accountService.PostHold(accountId, buildHoldBody({ amount: 0.01 })), 422, DETAIL.limit);
                expectBalanceUnchanged(before, await getBalance(accountService, accountId));
                expect((await accountService.GetHolds(accountId, "Active")).body).toHaveLength(5);
            });
        });

        test("HLD-19: Bloqueios Expired não contam para o limite", async ({ accountService }) => {
            test.setTimeout(90_000);
            const accountId = activeAccount(SLOT.HLD19);
            requireAvailable(await getBalance(accountService, accountId), 0.06);
            await fillActiveHolds(accountService, accountId, 4);
            const expiring = await createHold(accountService, accountId, { amount: 0.01, expiresAt: isoIn(15_000) });

            await test.step("aguarda a expiração do 5º", async () => {
                await waitForHoldStatus(accountService, accountId, expiring.holdId, "Expired", 60_000);
            });

            await test.step("novo bloqueio é aceito com 4 Active + 1 Expired", async () => {
                await createHold(accountService, accountId, { amount: 0.01 });
                expect((await accountService.GetHolds(accountId, "Active")).body).toHaveLength(5);
            });
        });

        test("HLD-20: amount maior que o availableBalance", async ({ accountService }) => {
            const accountId = activeAccount(SLOT.HLD20);
            requireAvailable(await getBalance(accountService, accountId), 0.02);

            await test.step("amount = availableBalance + 0,01", async () => {
                const before = await getBalance(accountService, accountId);
                const body = buildHoldBody({ amount: cents(before.availableBalance + 0.01) });
                expectProblem(await accountService.PostHold(accountId, body), 422, DETAIL.insufficient);
                expectBalanceUnchanged(before, await getBalance(accountService, accountId));
            });

            await test.step("com bloqueio prévio: amount <= balance, mas > availableBalance", async () => {
                await createHold(accountService, accountId, { amount: 0.01 });
                const before = await getBalance(accountService, accountId);
                const amount = cents(before.availableBalance + 0.01);
                expect(amount).toBeLessThanOrEqual(before.balance);
                expectProblem(await accountService.PostHold(accountId, buildHoldBody({ amount })), 422, DETAIL.insufficient);
                expectBalanceUnchanged(before, await getBalance(accountService, accountId));
            });

            await test.step("availableBalance zerado: amount 0,01", async () => {
                const remaining = (await getBalance(accountService, accountId)).availableBalance;
                await createHold(accountService, accountId, { amount: remaining });
                const before = await getBalance(accountService, accountId);
                expect(before.availableBalance).toBeCloseTo(0, 2);
                expectProblem(await accountService.PostHold(accountId, buildHoldBody({ amount: 0.01 })), 422, DETAIL.insufficient);
                expectBalanceUnchanged(before, await getBalance(accountService, accountId));
            });
        });

        test("HLD-21: Débito maior que o availableBalance é recusado com bloqueio ativo", async ({ accountService, transferService }) => {
            test.setTimeout(90_000);
            const source = activeAccount(SLOT.HLD21_SRC);
            const destination = activeAccount(SLOT.HLD21_DST);
            requireAvailable(await getBalance(accountService, source), 1.02);
            const hold = await createHold(accountService, source, { amount: 1.0 });

            await test.step("débito > availableBalance termina Failed", async () => {
                const before = await getBalance(accountService, source);
                const amount = cents(before.availableBalance + 0.01);
                expect(amount).toBeLessThanOrEqual(before.balance);

                const res = await transferService.PostTransfer({ sourceAccountId: source, destinationAccountId: destination, amount });
                expect(res.ok, JSON.stringify(res.body)).toBe(true);
                const transfer = await waitForTransferFinal(transferService, res.body.id);

                expect(transfer.status).toBe("Failed");
                expect(transfer.failureReason).toBe("Saldo insuficiente.");
                const after = await getBalance(accountService, source);
                expect(after.balance).toBeCloseTo(before.balance, 2);
                expect(after.blockedBalance).toBeCloseTo(before.blockedBalance, 2);
                expect(after.availableBalance).toBeCloseTo(before.availableBalance, 2);
                expect((await accountService.GetHold(source, hold.holdId)).body.status).toBe("Active");
            });

            await test.step("controle: débito <= availableBalance é concluído e não altera blockedBalance", async () => {
                const before = await getBalance(accountService, source);
                const res = await transferService.PostTransfer({ sourceAccountId: source, destinationAccountId: destination, amount: 0.01 });
                expect(res.ok, JSON.stringify(res.body)).toBe(true);
                const transfer = await waitForTransferFinal(transferService, res.body.id);

                expect(transfer.status).toBe("Completed");
                const after = await getBalance(accountService, source);
                expect(after.blockedBalance).toBeCloseTo(before.blockedBalance, 2);
            });
        });

        test("HLD-22: Ordem de avaliação das regras", async ({ accountService }) => {
            await test.step("conta inexistente + amount 0: 400 (R2), não 404", async () => {
                expectProblem(await accountService.PostHold(randomUUID(), buildHoldBody({ amount: 0 })), 400, DETAIL.amount);
            });

            const accountId = activeAccount(SLOT.HLD22);
            requireAvailable(await getBalance(accountService, accountId), 0.05);
            const holds = await fillActiveHolds(accountService, accountId, 5);
            const before = await getBalance(accountService, accountId);

            await test.step("5 Active + amount > availableBalance (reference nova): 422 R9", async () => {
                const body = buildHoldBody({ amount: cents(before.availableBalance + 0.01) });
                expectProblem(await accountService.PostHold(accountId, body), 422, DETAIL.limit);
            });

            await test.step("5 Active + repetição de um dos 5 com mesmo amount: 200", async () => {
                const res = await accountService.PostHold(accountId, buildHoldBody({ reference: holds[0].reference, amount: 0.01 }));
                expect(res.status).toBe(200);
                expect(res.body).toEqual(holds[0]);
            });

            await test.step("5 Active + reference de um dos 5 com outro amount: 409", async () => {
                const res = await accountService.PostHold(accountId, buildHoldBody({ reference: holds[1].reference, amount: 0.02 }));
                expectProblem(res, 409, DETAIL.referenceConflict);
            });

            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
            expect((await accountService.GetHolds(accountId, "Active")).body).toHaveLength(5);
        });

        test("HLD-22: Ordem de avaliação das regras (conta Closed + amount > availableBalance)", async ({ accountService }) => {
            const accountId = closedAccount();
            const before = await getBalance(accountService, accountId);
            const body = buildHoldBody({ amount: cents(before.availableBalance + 0.01) });

            expectProblem(await accountService.PostHold(accountId, body), 422, DETAIL.closed);
            expectBalanceUnchanged(before, await getBalance(accountService, accountId));
        });
    });
});
