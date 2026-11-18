/**
 * Criar Transferência (v1.1.0) — POST /transfers
 *
 * Regra: 202 grava a transferência em Screening (endToEndId `E99999999…`) e o processamento segue assíncrono:
 * antifraude → débito na origem → crédito no destino (Completed). Recusa do antifraude termina FraudRejected,
 * recusa do débito termina Failed sem movimento e recusa do crédito estorna a origem (Refunded, `D99999999…`).
 * Validação na ordem: origem = destino (R1), amount <= 0 (R2), mais de 2 casas (R3), description > 140 (R4), origem ausente (R5), destino ausente (R6).
 * Sem idempotência. failureReason truncado em 400 caracteres.
 *
 * Contas: cada teste abre as próprias contas pela API. Regras do antifraude: próprias, escopadas pela origem,
 * abaixo de 1000,00 e removidas no fim.
 * Fora do escopo (v1.0.0): RefundFailed (P10, intervalo débito→devolução não controlável); o extrato é verificado em TRF-01 e TRF-21.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "../../fixtures/ApiFixtures";
import { openAccountId } from "../helpers/account/accounts";
import { cents, createHold, getBalance } from "../helpers/account/holds";
import { getStatement } from "../helpers/account/statement";
import { expectProblem } from "../helpers/common/problem";
import {
    buildTransferBody,
    createTransfer,
    EMPTY_GUID,
    endToEndIdInstant,
    endToEndIdPattern,
    expectBalanceMoved,
    expectCompletedLegs,
    expectNoLegs,
    FAILURE_REASON,
    invalidTransferBody,
    TRANSFER_DETAIL,
    transferAndWait,
    waitForTransferStatus,
    withRule,
} from "../helpers/transfer/transfers";

test.describe("POST /transfers", { tag: ["@transfer", "@spec:criar-transferencia"] }, () => {
    test.describe("criação", () => {
        test("TRF-01: Transferência aprovada termina Completed com débito na origem e crédito no destino", async ({
            accountService,
            transferService,
        }) => {
            const source = await openAccountId(accountService, { initialDeposit: 100 });
            const destination = await openAccountId(accountService, { initialDeposit: 10 });
            const sourceBefore = await getBalance(accountService, source);
            const destinationBefore = await getBalance(accountService, destination);
            const body = buildTransferBody(source, destination, { amount: 12.34, description: "Aluguel de novembro" });

            const created = await test.step("aceita com 202 em Screening", async () => {
                const startedAt = Date.now();
                const transfer = await createTransfer(transferService, body);
                expect(transfer.endToEndId).toHaveLength(32);
                expect(Math.abs(endToEndIdInstant(transfer.endToEndId) - startedAt)).toBeLessThan(2 * 60_000);
                expect(transfer.updatedAt).toBe(transfer.createdAt);
                return transfer;
            });

            const done = await test.step("termina Completed com as pernas nas contas certas", async () => {
                const transfer = await waitForTransferStatus(transferService, created.id, "Completed");
                expectCompletedLegs(transfer);
                expect(transfer).toMatchObject({
                    id: created.id,
                    endToEndId: created.endToEndId,
                    amount: 12.34,
                    description: "Aluguel de novembro",
                    createdAt: created.createdAt,
                });
                expect(transfer.debit!.accountId).toBe(source);
                expect(transfer.credit!.accountId).toBe(destination);
                return transfer;
            });

            await test.step("origem − amount e destino + amount, version + 1 em cada", async () => {
                expectBalanceMoved(sourceBefore, await getBalance(accountService, source), -body.amount);
                expectBalanceMoved(destinationBefore, await getBalance(accountService, destination), body.amount);
            });

            await test.step("extrato: Debit na origem e Credit no destino com os ids das pernas", async () => {
                const sourceItems = (await getStatement(accountService, source)).items.filter((i) => i.endToEndId === done.endToEndId);
                expect(sourceItems).toEqual([
                    expect.objectContaining({ entryId: done.debit!.entryId, type: "Debit", amount: 12.34, description: "Aluguel de novembro" }),
                ]);
                const destinationItems = (await getStatement(accountService, destination)).items.filter(
                    (i) => i.endToEndId === done.endToEndId
                );
                expect(destinationItems).toEqual([
                    expect.objectContaining({ entryId: done.credit!.entryId, type: "Credit", amount: 12.34, description: "Aluguel de novembro" }),
                ]);
            });

            await test.step("o estado final é estável", async () => {
                const again = await transferService.GetTransfer(done.id);
                expect(again.body).toEqual(done);
            });
        });

        test("TRF-02: Sem description grava null e completa", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService);
            const body = buildTransferBody(source, destination, { amount: 1.0 });
            delete body.description;

            const transfer = await transferAndWait(transferService, body, "Completed");
            expect(transfer.description).toBeNull();
            expectCompletedLegs(transfer);
        });

        test("TRF-03: amount igual ao availableBalance da origem é aceito e zera a origem", async ({
            accountService,
            transferService,
        }) => {
            const source = await openAccountId(accountService, { initialDeposit: 50 });
            const destination = await openAccountId(accountService, { initialDeposit: 0 });
            await createHold(accountService, source, { amount: 7.5 });
            const sourceBefore = await getBalance(accountService, source);
            expect(sourceBefore.availableBalance).toBeCloseTo(42.5, 2);

            const transfer = await transferAndWait(
                transferService,
                buildTransferBody(source, destination, { amount: sourceBefore.availableBalance }),
                "Completed"
            );
            expectCompletedLegs(transfer);

            const sourceAfter = await getBalance(accountService, source);
            expectBalanceMoved(sourceBefore, sourceAfter, -42.5);
            expect(sourceAfter.availableBalance).toBeCloseTo(0, 2);
            expect((await getBalance(accountService, destination)).balance).toBeCloseTo(42.5, 2);
        });

        test("TRF-04: amount mínimo de 0,01 é aceito e movimenta um centavo", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService, { initialDeposit: 1 });
            const destination = await openAccountId(accountService, { initialDeposit: 0 });
            const sourceBefore = await getBalance(accountService, source);
            const destinationBefore = await getBalance(accountService, destination);

            const transfer = await transferAndWait(transferService, buildTransferBody(source, destination, { amount: 0.01 }), "Completed");
            expect(transfer.amount).toBe(0.01);
            expectCompletedLegs(transfer);
            expectBalanceMoved(sourceBefore, await getBalance(accountService, source), -0.01);
            expectBalanceMoved(destinationBefore, await getBalance(accountService, destination), 0.01);
        });

        test("TRF-05: description com 140 caracteres é aceita e gravada sem corte", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService);
            const description = "d".repeat(139) + "Z";

            const transfer = await transferAndWait(
                transferService,
                buildTransferBody(source, destination, { amount: 0.5, description }),
                "Completed"
            );
            expect(transfer.description).toBe(description);
        });
    });

    test.describe("validação do corpo", () => {
        test("TRF-06: Origem igual ao destino, inclusive ambos ausentes, responde 400", async ({ accountService, transferService }) => {
            const account = await openAccountId(accountService);
            const before = await getBalance(accountService, account);

            const variations = [
                { label: "mesma conta", body: buildTransferBody(account, account) },
                { label: "mesma conta com id em maiúsculas", body: buildTransferBody(account, account.toUpperCase()) },
                { label: "ambos ausentes", body: invalidTransferBody({ amount: 1.0 }) },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    expectProblem(await transferService.PostTransfer(v.body), 400, TRANSFER_DETAIL.sameAccount);
                });
            }

            await test.step("saldo e version não mudam", async () => {
                expect(await getBalance(accountService, account)).toEqual(before);
            });
        });

        test("TRF-07: amount ausente, zero ou negativo responde 400", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService);
            const before = await getBalance(accountService, source);

            const variations = [
                { label: "ausente", body: invalidTransferBody({ sourceAccountId: source, destinationAccountId: destination }) },
                { label: "zero", body: buildTransferBody(source, destination, { amount: 0 }) },
                { label: "negativo", body: buildTransferBody(source, destination, { amount: -0.01 }) },
                { label: "negativo grande", body: buildTransferBody(source, destination, { amount: -100 }) },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    expectProblem(await transferService.PostTransfer(v.body), 400, TRANSFER_DETAIL.amount);
                });
            }

            await test.step("saldo da origem não muda", async () => {
                expect(await getBalance(accountService, source)).toEqual(before);
            });
        });

        test("TRF-08: amount com mais de 2 casas decimais responde 400", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService);

            for (const amount of [0.001, 1.005, 10.123, 99.999]) {
                await test.step(`amount ${amount}`, async () => {
                    expectProblem(
                        await transferService.PostTransfer(buildTransferBody(source, destination, { amount })),
                        400,
                        TRANSFER_DETAIL.decimals
                    );
                });
            }

            await test.step("controle: 2 casas são aceitas", async () => {
                await createTransfer(transferService, buildTransferBody(source, destination, { amount: 0.99 }));
            });
        });

        test("TRF-09: description com 141 caracteres responde 400", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService);
            const before = await getBalance(accountService, source);

            for (const length of [141, 300]) {
                await test.step(`${length} caracteres`, async () => {
                    expectProblem(
                        await transferService.PostTransfer(buildTransferBody(source, destination, { description: "x".repeat(length) })),
                        400,
                        TRANSFER_DETAIL.description
                    );
                });
            }

            await test.step("saldo da origem não muda", async () => {
                expect(await getBalance(accountService, source)).toEqual(before);
            });
        });

        test("TRF-10: Só a primeira regra violada é devolvida, na ordem R1, R2, R3, R4", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService);
            const longDescription = "x".repeat(141);

            const variations = [
                {
                    label: "R1 antes de R2, R4",
                    body: buildTransferBody(source, source, { amount: 0, description: longDescription }),
                    detail: TRANSFER_DETAIL.sameAccount,
                },
                {
                    label: "R2 antes de R4",
                    body: buildTransferBody(source, destination, { amount: -1, description: longDescription }),
                    detail: TRANSFER_DETAIL.amount,
                },
                {
                    label: "R2 antes de R3",
                    body: buildTransferBody(source, destination, { amount: -0.001 }),
                    detail: TRANSFER_DETAIL.amount,
                },
                {
                    label: "R3 antes de R4",
                    body: buildTransferBody(source, destination, { amount: 0.001, description: longDescription }),
                    detail: TRANSFER_DETAIL.decimals,
                },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    const res = await transferService.PostTransfer(v.body);
                    expectProblem(res, 400, v.detail);
                    expect((res.body as unknown as { title: string }).title).toBe("Requisição inválida.");
                });
            }
        });

        test("TRF-11: Corpo ausente ou JSON malformado responde 400", async ({ transferService }) => {
            for (const raw of ["", "{bad", "[]", '{"amount":"abc"}']) {
                await test.step(`corpo ${JSON.stringify(raw)}`, async () => {
                    const res = await transferService.PostTransferRaw(raw);
                    expect(res.status, res.text).toBe(400);
                });
            }
        });
    });

    test.describe("processamento", () => {
        test("TRF-12: Valor a partir de 1000,00 é recusado pelo antifraude padrão e 999,99 passa", async ({
            accountService,
            transferService,
        }) => {
            const source = await openAccountId(accountService, { initialDeposit: 2000 });
            const destination = await openAccountId(accountService, { initialDeposit: 0 });
            const sourceBefore = await getBalance(accountService, source);
            const destinationBefore = await getBalance(accountService, destination);

            await test.step("1000,00 termina FraudRejected sem movimento", async () => {
                const transfer = await transferAndWait(
                    transferService,
                    buildTransferBody(source, destination, { amount: 1000.0 }),
                    "FraudRejected"
                );
                expectNoLegs(transfer, "FraudRejected", FAILURE_REASON.highValue);
                expect(await getBalance(accountService, source)).toEqual(sourceBefore);
                expect(await getBalance(accountService, destination)).toEqual(destinationBefore);
            });

            await test.step("controle: 999,99 termina Completed", async () => {
                const transfer = await transferAndWait(
                    transferService,
                    buildTransferBody(source, destination, { amount: 999.99 }),
                    "Completed"
                );
                expectCompletedLegs(transfer);
                expectBalanceMoved(sourceBefore, await getBalance(accountService, source), -999.99);
            });
        });

        test("TRF-13: Recusa do antifraude grava o motivo da regra e não movimenta", async ({
            accountService,
            antifraudService,
            transferService,
        }) => {
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService);
            const sourceBefore = await getBalance(accountService, source);
            const destinationBefore = await getBalance(accountService, destination);
            const reason = `Suspeita de golpe ${randomUUID()}`;

            await withRule(antifraudService, { decision: "Rejected", reason, sourceAccountIds: [source] }, async () => {
                const transfer = await transferAndWait(transferService, buildTransferBody(source, destination, { amount: 5 }), "FraudRejected");
                expectNoLegs(transfer, "FraudRejected", reason);
                expect(Date.parse(transfer.updatedAt)).toBeGreaterThan(Date.parse(transfer.createdAt));
            });

            expect(await getBalance(accountService, source)).toEqual(sourceBefore);
            expect(await getBalance(accountService, destination)).toEqual(destinationBefore);
        });

        test("TRF-14: Recusa por regra sem motivo grava o motivo padrão do antifraude com o id da regra", async ({
            accountService,
            antifraudService,
            transferService,
        }) => {
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService);

            await withRule(antifraudService, { decision: "Rejected", reason: null, sourceAccountIds: [source] }, async (rule) => {
                const transfer = await transferAndWait(transferService, buildTransferBody(source, destination), "FraudRejected");
                expectNoLegs(transfer, "FraudRejected", FAILURE_REASON.ruleDefault(rule.id));
            });
        });

        test("TRF-15: failureReason maior que 400 caracteres é truncado em 400", async ({
            accountService,
            antifraudService,
            transferService,
        }) => {
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService);
            const exact = "a".repeat(399) + "B";
            const long = exact + "C".repeat(50);

            await withRule(antifraudService, { decision: "Rejected", reason: long, sourceAccountIds: [source] }, async () => {
                const transfer = await transferAndWait(transferService, buildTransferBody(source, destination), "FraudRejected");
                expect(transfer.failureReason).toHaveLength(400);
                expect(transfer.failureReason).toBe(exact);
            });
        });

        test("TRF-16: Antifraude sem decisão a tempo termina FraudRejected por timeout", async ({
            accountService,
            antifraudService,
            transferService,
        }) => {
            test.setTimeout(180_000);
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService);
            const sourceBefore = await getBalance(accountService, source);

            await withRule(
                antifraudService,
                { decision: "Approved", delayMs: 120_000, sourceAccountIds: [source] },
                async () => {
                    const created = await createTransfer(transferService, buildTransferBody(source, destination));
                    const transfer = await waitForTransferStatus(transferService, created.id, "FraudRejected", 150_000);
                    expectNoLegs(transfer, "FraudRejected", FAILURE_REASON.screeningTimeout);
                    const elapsed = Date.parse(transfer.updatedAt) - Date.parse(transfer.createdAt);
                    expect(elapsed, "decisão só depois do timeout de 60 s").toBeGreaterThanOrEqual(60_000);
                }
            );

            expect(await getBalance(accountService, source)).toEqual(sourceBefore);
        });

        test("TRF-17: Origem inexistente termina Failed sem movimento no destino", async ({ accountService, transferService }) => {
            const source = randomUUID();
            const destination = await openAccountId(accountService);
            const destinationBefore = await getBalance(accountService, destination);

            const transfer = await transferAndWait(transferService, buildTransferBody(source, destination), "Failed");
            expectNoLegs(transfer, "Failed", FAILURE_REASON.notFound(source));
            expect(await getBalance(accountService, destination)).toEqual(destinationBefore);
        });

        test("TRF-18: Origem Closed termina Failed", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService, { initialDeposit: 0, status: "Closed" });
            const destination = await openAccountId(accountService);
            const destinationBefore = await getBalance(accountService, destination);

            const transfer = await transferAndWait(transferService, buildTransferBody(source, destination, { amount: 0.01 }), "Failed");
            expectNoLegs(transfer, "Failed", FAILURE_REASON.closed);
            expect(await getBalance(accountService, destination)).toEqual(destinationBefore);
        });

        test("TRF-19: Origem Blocked termina Failed e mantém o saldo", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService, { status: "Blocked" });
            const destination = await openAccountId(accountService);
            const sourceBefore = await getBalance(accountService, source);
            const destinationBefore = await getBalance(accountService, destination);

            const transfer = await transferAndWait(transferService, buildTransferBody(source, destination), "Failed");
            expectNoLegs(transfer, "Failed", FAILURE_REASON.blocked);
            expect(await getBalance(accountService, source)).toEqual(sourceBefore);
            expect(await getBalance(accountService, destination)).toEqual(destinationBefore);
        });

        test("TRF-20: amount maior que o availableBalance termina Failed por saldo insuficiente", async ({
            accountService,
            transferService,
        }) => {
            const source = await openAccountId(accountService, { initialDeposit: 20 });
            const destination = await openAccountId(accountService);
            const destinationBefore = await getBalance(accountService, destination);

            await test.step("um centavo acima do saldo", async () => {
                const before = await getBalance(accountService, source);
                const transfer = await transferAndWait(
                    transferService,
                    buildTransferBody(source, destination, { amount: cents(before.availableBalance + 0.01) }),
                    "Failed"
                );
                expectNoLegs(transfer, "Failed", FAILURE_REASON.insufficient);
                expect(await getBalance(accountService, source)).toEqual(before);
            });

            await test.step("dentro do balance mas acima do disponível por causa de bloqueio", async () => {
                await createHold(accountService, source, { amount: 15 });
                const before = await getBalance(accountService, source);
                expect(before.availableBalance).toBeCloseTo(5, 2);
                const transfer = await transferAndWait(
                    transferService,
                    buildTransferBody(source, destination, { amount: 5.01 }),
                    "Failed"
                );
                expectNoLegs(transfer, "Failed", FAILURE_REASON.insufficient);
                expect(await getBalance(accountService, source)).toEqual(before);
            });

            expect(await getBalance(accountService, destination)).toEqual(destinationBefore);
        });

        test("TRF-21: Destino inexistente estorna a origem e termina Refunded", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService, { initialDeposit: 30 });
            const destination = randomUUID();
            const sourceBefore = await getBalance(accountService, source);

            const transfer = await transferAndWait(
                transferService,
                buildTransferBody(source, destination, { amount: 12.5 }),
                "Refunded"
            );

            await test.step("débito e devolução na origem, sem crédito no destino", async () => {
                expect(transfer.failureReason).toBe(FAILURE_REASON.notFound(destination));
                expect(transfer.refundEndToEndId).toMatch(endToEndIdPattern("D"));
                expect(transfer.refundEndToEndId).not.toBe(transfer.endToEndId);
                expect(transfer.credit).toBeNull();
                expect(transfer.debit).toMatchObject({ accountId: source, endToEndId: transfer.endToEndId });
                expect(transfer.refund).toMatchObject({ accountId: source, endToEndId: transfer.refundEndToEndId });
                expect(transfer.refund!.entryId).not.toBe(transfer.debit!.entryId);
            });

            await test.step("extrato da origem: Debit com o endToEndId e Credit de devolução com o refundEndToEndId", async () => {
                const items = (await getStatement(accountService, source)).items;
                expect(items.filter((i) => i.endToEndId === transfer.endToEndId)).toEqual([
                    expect.objectContaining({ entryId: transfer.debit!.entryId, type: "Debit", amount: 12.5 }),
                ]);
                expect(items.filter((i) => i.endToEndId === transfer.refundEndToEndId)).toEqual([
                    expect.objectContaining({
                        entryId: transfer.refund!.entryId,
                        type: "Credit",
                        amount: 12.5,
                        description: `Devolução da transferência ${transfer.id}`,
                    }),
                ]);
            });

            await test.step("saldo final da origem igual ao inicial (débito + devolução)", async () => {
                const after = await getBalance(accountService, source);
                expect(after.balance).toBeCloseTo(sourceBefore.balance, 2);
                expect(after.availableBalance).toBeCloseTo(sourceBefore.availableBalance, 2);
                expect(after.version).toBe(sourceBefore.version + 2);
            });
        });

        test("TRF-22: Destino Closed estorna a origem e termina Refunded", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService, { initialDeposit: 0, status: "Closed" });
            const sourceBefore = await getBalance(accountService, source);
            const destinationBefore = await getBalance(accountService, destination);

            const transfer = await transferAndWait(transferService, buildTransferBody(source, destination, { amount: 3 }), "Refunded");
            expect(transfer.failureReason).toBe(FAILURE_REASON.closed);
            expect(transfer.refundEndToEndId).toMatch(endToEndIdPattern("D"));
            expect(transfer.credit).toBeNull();
            expect(transfer.refund).toMatchObject({ accountId: source, endToEndId: transfer.refundEndToEndId });

            const sourceAfter = await getBalance(accountService, source);
            expect(sourceAfter.balance).toBeCloseTo(sourceBefore.balance, 2);
            expect(sourceAfter.version).toBe(sourceBefore.version + 2);
            expect(await getBalance(accountService, destination)).toEqual(destinationBefore);
        });

        test("TRF-23: Destino Blocked recebe o crédito normalmente", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService);
            const destination = await openAccountId(accountService, { status: "Blocked" });
            const destinationBefore = await getBalance(accountService, destination);

            const transfer = await transferAndWait(transferService, buildTransferBody(source, destination, { amount: 2 }), "Completed");
            expectCompletedLegs(transfer);
            expectBalanceMoved(destinationBefore, await getBalance(accountService, destination), 2);
        });

        test("TRF-24: Origem e destino inexistentes terminam Failed pelo motivo da origem", async ({ transferService }) => {
            const source = randomUUID();
            const destination = randomUUID();

            const transfer = await transferAndWait(transferService, buildTransferBody(source, destination), "Failed");
            expectNoLegs(transfer, "Failed", FAILURE_REASON.notFound(source));
        });

        test("TRF-25: Origem ou destino ausente (ou guid vazio) é recusado na criação (R5, R6)", async ({ accountService, transferService }) => {
            const account = await openAccountId(accountService);
            const variations = [
                { label: "origem ausente", body: invalidTransferBody({ destinationAccountId: account, amount: 1.0 }), detail: TRANSFER_DETAIL.sourceRequired },
                { label: "origem guid vazio", body: invalidTransferBody({ sourceAccountId: EMPTY_GUID, destinationAccountId: account, amount: 1.0 }), detail: TRANSFER_DETAIL.sourceRequired },
                { label: "destino ausente", body: invalidTransferBody({ sourceAccountId: account, amount: 1.0 }), detail: TRANSFER_DETAIL.destinationRequired },
                { label: "destino guid vazio", body: invalidTransferBody({ sourceAccountId: account, destinationAccountId: EMPTY_GUID, amount: 1.0 }), detail: TRANSFER_DETAIL.destinationRequired },
            ];
            const before = await getBalance(accountService, account);
            for (const v of variations) {
                await test.step(v.label, async () => {
                    expectProblem(await transferService.PostTransfer(v.body), 400, v.detail);
                });
            }
            expect(await getBalance(accountService, account)).toEqual(before);
        });
    });

    test.describe("idempotência", () => {
        test("TRF-26: Duas requisições iguais criam duas transferências independentes", async ({ accountService, transferService }) => {
            const source = await openAccountId(accountService, { initialDeposit: 10 });
            const destination = await openAccountId(accountService, { initialDeposit: 0 });
            const sourceBefore = await getBalance(accountService, source);
            const body = buildTransferBody(source, destination, { amount: 1.25, description: "Pagamento repetido" });

            const first = await createTransfer(transferService, body);
            const second = await createTransfer(transferService, body);
            expect(second.id).not.toBe(first.id);
            expect(second.endToEndId).not.toBe(first.endToEndId);

            const done = await Promise.all([
                waitForTransferStatus(transferService, first.id, "Completed"),
                waitForTransferStatus(transferService, second.id, "Completed"),
            ]);
            expect(done[0].debit!.entryId).not.toBe(done[1].debit!.entryId);
            expectBalanceMoved(sourceBefore, await getBalance(accountService, source), -2.5, 2);
            expect((await getBalance(accountService, destination)).balance).toBeCloseTo(2.5, 2);
        });

        test("TRF-27: Webhook de aprovação repetido não gera débito nem crédito duplicado", async ({
            accountService,
            antifraudService,
            transferService,
        }) => {
            const source = await openAccountId(accountService, { initialDeposit: 10 });
            const destination = await openAccountId(accountService, { initialDeposit: 0 });
            const sourceBefore = await getBalance(accountService, source);
            const destinationBefore = await getBalance(accountService, destination);

            await withRule(
                antifraudService,
                { decision: "Approved", delivery: "Duplicate", sourceAccountIds: [source] },
                async () => {
                    const transfer = await transferAndWait(transferService, buildTransferBody(source, destination, { amount: 4 }), "Completed");
                    expectCompletedLegs(transfer);
                }
            );

            expectBalanceMoved(sourceBefore, await getBalance(accountService, source), -4);
            expectBalanceMoved(destinationBefore, await getBalance(accountService, destination), 4);
        });
    });
});
