/**
 * Simulação de Transferências (v1.0.0) — POST /simulations
 *
 * Regra: 202 (Location /simulations/{id}) gera N transferências aleatórias entre as contas informadas, todas com o
 * mesmo simulationId, description `Simulação {i}/{N}`, origem ≠ destino e amount sorteado em [min, max] com 2 casas.
 * Validação na ordem: transfers fora de 1..1000 (R1), minAmount < 0,01 ou max < min (R2), menos de 2 contas
 * distintas (R3). Contas não são validadas; a soma dos saldos envolvidos se conserva.
 *
 * Contas: cada teste abre as próprias contas pela API.
 * Fora do escopo (v1.0.0): contas padrão (seed) quando accountIds é omitido e transfers = 1000 (carga).
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "../../fixtures/ApiFixtures";
import { openAccountId } from "../helpers/account/accounts";
import { getBalance } from "../helpers/account/holds";
import { expectProblem } from "../helpers/common/problem";
import {
    buildSimulationBody,
    expectGeneratedTransfers,
    expectSummaryTotals,
    invalidSimulationBody,
    listSimulationTransfers,
    SIMULATION_DETAIL,
    startSimulation,
    sumBalances,
    waitForSimulationFinished,
} from "../helpers/transfer/simulations";
import { expectCompletedLegs, FAILURE_REASON } from "../helpers/transfer/transfers";

test.describe("POST /simulations", { tag: ["@transfer", "@spec:simulacao-transferencias"] }, () => {
    test.describe("criação", () => {
        test("SIM-01: Gera N transferências entre as contas informadas e todas completam", async ({ accountService, transferService }) => {
            const accountIds = await Promise.all([1, 2, 3].map(() => openAccountId(accountService, { initialDeposit: 50 })));
            const totalBefore = await sumBalances(accountService, accountIds);
            const body = buildSimulationBody(accountIds, { transfers: 6, minAmount: 0.01, maxAmount: 1.0 });

            const simulationId = await startSimulation(transferService, body);

            await test.step("transferências geradas seguem a regra de sorteio", async () => {
                expectGeneratedTransfers(await listSimulationTransfers(transferService, simulationId), simulationId, body);
            });

            await test.step("termina com todas Completed", async () => {
                const summary = await waitForSimulationFinished(transferService, simulationId);
                expectSummaryTotals(summary, simulationId, 6);
                expect(summary.byStatus).toEqual({ Completed: 6 });
                for (const t of await listSimulationTransfers(transferService, simulationId)) expectCompletedLegs(t);
            });

            await test.step("soma dos saldos das contas não muda", async () => {
                expect(await sumBalances(accountService, accountIds)).toBeCloseTo(totalBefore, 2);
            });
        });

        test("SIM-02: minAmount = maxAmount = 0,01 gera todas as transferências com 0,01", async ({ accountService, transferService }) => {
            const accountIds = [await openAccountId(accountService), await openAccountId(accountService)];
            const body = buildSimulationBody(accountIds, { transfers: 4, minAmount: 0.01, maxAmount: 0.01 });

            const simulationId = await startSimulation(transferService, body);
            const transfers = await listSimulationTransfers(transferService, simulationId);
            expectGeneratedTransfers(transfers, simulationId, body);
            expect(transfers.every((t) => t.amount === 0.01)).toBe(true);
            await waitForSimulationFinished(transferService, simulationId);
        });

        test("SIM-03: transfers = 1 gera uma única transferência 'Simulação 1/1'", async ({ accountService, transferService }) => {
            const accountIds = [await openAccountId(accountService), await openAccountId(accountService)];
            const body = buildSimulationBody(accountIds, { transfers: 1, minAmount: 2.5, maxAmount: 2.5 });

            const simulationId = await startSimulation(transferService, body);
            const [transfer] = await listSimulationTransfers(transferService, simulationId);
            expect(transfer).toMatchObject({ description: "Simulação 1/1", amount: 2.5, simulationId });
            const summary = await waitForSimulationFinished(transferService, simulationId);
            expect(summary).toMatchObject({ total: 1, byStatus: { Completed: 1 } });
        });

        test("SIM-04: Ids repetidos com 2 contas distintas são aceitos", async ({ accountService, transferService }) => {
            const a = await openAccountId(accountService);
            const b = await openAccountId(accountService);
            const body = buildSimulationBody([a, a, b, a], { transfers: 3 });

            const simulationId = await startSimulation(transferService, body);
            expectGeneratedTransfers(await listSimulationTransfers(transferService, simulationId), simulationId, body);
            await waitForSimulationFinished(transferService, simulationId);
        });

        test("SIM-05: Contas inexistentes geram transferências Failed ou Refunded e conservam o saldo da conta real", async ({
            accountService,
            transferService,
        }) => {
            const real = await openAccountId(accountService, { initialDeposit: 20 });
            const ghost = randomUUID();
            const before = await getBalance(accountService, real);
            const body = buildSimulationBody([real, ghost], { transfers: 4, minAmount: 0.5, maxAmount: 1.0 });

            const simulationId = await startSimulation(transferService, body);
            const summary = await waitForSimulationFinished(transferService, simulationId);
            expectSummaryTotals(summary, simulationId, 4);

            for (const t of await listSimulationTransfers(transferService, simulationId)) {
                if (t.sourceAccountId === ghost) {
                    expect(t).toMatchObject({ status: "Failed", failureReason: FAILURE_REASON.notFound(ghost) });
                } else {
                    expect(t).toMatchObject({ status: "Refunded", failureReason: FAILURE_REASON.notFound(ghost) });
                }
            }
            expect((await getBalance(accountService, real)).balance).toBeCloseTo(before.balance, 2);
        });

        test("SIM-06: Saldo limitado gera falhas por saldo insuficiente sem criar nem destruir dinheiro", async ({
            accountService,
            transferService,
        }) => {
            const accountIds = [
                await openAccountId(accountService, { initialDeposit: 1 }),
                await openAccountId(accountService, { initialDeposit: 1 }),
            ];
            const totalBefore = await sumBalances(accountService, accountIds);
            const body = buildSimulationBody(accountIds, { transfers: 10, minAmount: 0.6, maxAmount: 1.0 });

            const simulationId = await startSimulation(transferService, body);
            const summary = await waitForSimulationFinished(transferService, simulationId);
            expectSummaryTotals(summary, simulationId, 10);
            expect(Object.keys(summary.byStatus).every((s) => s === "Completed" || s === "Failed")).toBe(true);
            expect(summary.byStatus.Failed ?? 0, "parte falha por saldo").toBeGreaterThan(0);

            const failed = (await listSimulationTransfers(transferService, simulationId)).filter((t) => t.status === "Failed");
            expect(failed.every((t) => t.failureReason === FAILURE_REASON.insufficient)).toBe(true);
            expect(await sumBalances(accountService, accountIds)).toBeCloseTo(totalBefore, 2);
            for (const id of accountIds) expect((await getBalance(accountService, id)).balance).toBeGreaterThanOrEqual(0);
        });
    });

    test.describe("validação do corpo", () => {
        test("SIM-07: transfers ausente, menor que 1 ou maior que 1000 responde 400", async ({ accountService, transferService }) => {
            const accountIds = [await openAccountId(accountService), await openAccountId(accountService)];
            const before = await sumBalances(accountService, accountIds);

            const variations = [
                { label: "ausente", body: invalidSimulationBody({ minAmount: 0.01, maxAmount: 1, accountIds }) },
                { label: "0", body: buildSimulationBody(accountIds, { transfers: 0 }) },
                { label: "-1", body: buildSimulationBody(accountIds, { transfers: -1 }) },
                { label: "1001", body: buildSimulationBody(accountIds, { transfers: 1001 }) },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    expectProblem(await transferService.PostSimulation(v.body), 400, SIMULATION_DETAIL.transfers);
                });
            }
            expect(await sumBalances(accountService, accountIds)).toBe(before);
        });

        test("SIM-08: Intervalo com mínimo abaixo de 0,01 ou máximo abaixo do mínimo responde 400", async ({
            accountService,
            transferService,
        }) => {
            const accountIds = [await openAccountId(accountService), await openAccountId(accountService)];

            const variations = [
                { label: "minAmount ausente", body: invalidSimulationBody({ transfers: 1, maxAmount: 1, accountIds }) },
                { label: "minAmount 0", body: buildSimulationBody(accountIds, { minAmount: 0, maxAmount: 1 }) },
                { label: "minAmount 0,009", body: buildSimulationBody(accountIds, { minAmount: 0.009, maxAmount: 1 }) },
                { label: "minAmount negativo", body: buildSimulationBody(accountIds, { minAmount: -1, maxAmount: 1 }) },
                { label: "maxAmount 0,01 abaixo do mínimo", body: buildSimulationBody(accountIds, { minAmount: 1, maxAmount: 0.99 }) },
                { label: "maxAmount ausente", body: invalidSimulationBody({ transfers: 1, minAmount: 0.01, accountIds }) },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    expectProblem(await transferService.PostSimulation(v.body), 400, SIMULATION_DETAIL.range);
                });
            }
        });

        test("SIM-09: Menos de duas contas distintas responde 400", async ({ accountService, transferService }) => {
            const account = await openAccountId(accountService);
            const before = await getBalance(accountService, account);

            const variations = [
                { label: "uma conta", accountIds: [account] },
                { label: "a mesma conta repetida", accountIds: [account, account, account] },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    expectProblem(
                        await transferService.PostSimulation(buildSimulationBody(v.accountIds, { transfers: 1 })),
                        400,
                        SIMULATION_DETAIL.accounts
                    );
                });
            }
            expect(await getBalance(accountService, account)).toEqual(before);
        });

        test("SIM-10: Só a primeira regra violada é devolvida, na ordem R1, R2, R3", async ({ accountService, transferService }) => {
            const account = await openAccountId(accountService);

            const variations = [
                { label: "R1 antes de R2 e R3", body: buildSimulationBody([account], { transfers: 0, minAmount: 0 }), detail: SIMULATION_DETAIL.transfers },
                { label: "R2 antes de R3", body: buildSimulationBody([account], { transfers: 1, minAmount: 0 }), detail: SIMULATION_DETAIL.range },
            ];
            for (const v of variations) {
                await test.step(v.label, async () => {
                    expectProblem(await transferService.PostSimulation(v.body), 400, v.detail);
                });
            }
        });
    });
});
