/**
 * Simulação de Transferências (v1.0.0) — GET /simulations/{simulationId}
 *
 * Regra: 200 com `total` (= transfers desde a primeira consulta), `finished` (nenhuma em Screening, Debiting,
 * Crediting ou Refunding) e `byStatus` (só status com pelo menos uma transferência; soma = total).
 * Simulação inexistente responde 404 sem corpo.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "../../fixtures/ApiFixtures";
import { openAccountId } from "../helpers/account/accounts";
import {
    expectSummaryTotals,
    getSimulation,
    listSimulationTransfers,
    startSimulation,
    waitForSimulationFinished,
} from "../helpers/transfer/simulations";
import { expectNoLegs, withRule } from "../helpers/transfer/transfers";

test.describe("GET /simulations/{simulationId}", { tag: ["@transfer", "@spec:simulacao-transferencias"] }, () => {
    test("SIM-11: Logo após o 202 todas estão em Screening e finished é false", async ({
        accountService,
        antifraudService,
        transferService,
    }) => {
        const accountIds = [await openAccountId(accountService), await openAccountId(accountService)];

        await withRule(antifraudService, { decision: "Approved", delayMs: 5_000, sourceAccountIds: accountIds }, async () => {
            const simulationId = await startSimulation(transferService, { transfers: 5, minAmount: 0.01, maxAmount: 0.1, accountIds });

            const summary = await getSimulation(transferService, simulationId);
            expectSummaryTotals(summary, simulationId, 5);
            expect(summary.finished).toBe(false);
            expect(summary.byStatus).toEqual({ Screening: 5 });

            const final = await waitForSimulationFinished(transferService, simulationId);
            expectSummaryTotals(final, simulationId, 5);
            expect(final.byStatus).toEqual({ Completed: 5 });
        });
    });

    test("SIM-12: Resumo final lista só os status presentes e soma o total", async ({
        accountService,
        antifraudService,
        transferService,
    }) => {
        const accountIds = [await openAccountId(accountService), await openAccountId(accountService)];
        const reason = `Simulação recusada ${randomUUID()}`;

        await withRule(antifraudService, { decision: "Rejected", reason, sourceAccountIds: accountIds }, async () => {
            const simulationId = await startSimulation(transferService, { transfers: 3, minAmount: 0.01, maxAmount: 0.5, accountIds });
            const summary = await waitForSimulationFinished(transferService, simulationId);

            expectSummaryTotals(summary, simulationId, 3);
            expect(summary).toEqual({ simulationId, total: 3, finished: true, byStatus: { FraudRejected: 3 } });
            for (const t of await listSimulationTransfers(transferService, simulationId)) expectNoLegs(t, "FraudRejected", reason);
        });
    });

    test("SIM-13: Simulação inexistente responde 404 sem corpo", async ({ transferService }) => {
        for (const id of [randomUUID(), "nao-e-guid"]) {
            await test.step(id, async () => {
                const res = await transferService.GetSimulation(id);
                expect(res.status, res.text).toBe(404);
                expect(res.text).toBe("");
            });
        }
    });
});
