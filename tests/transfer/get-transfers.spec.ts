/**
 * Criar Transferência (v1.0.0) — GET /transfers?simulationId=&status=&take=
 *
 * Regra: lista as transferências da mais nova para a mais antiga; filtros opcionais por simulationId e status;
 * `take` padrão 50, limitado entre 1 e 500.
 */
import { ContractValidator } from "../../core/schema/ContractValidator";
import { GetTransfersResponseSchema } from "../../domains/transfer/GetTransfersResponseSchema";
import { expect, test } from "../../fixtures/ApiFixtures";
import { openAccountId } from "../helpers/account/accounts";
import { listSimulationTransfers, startSimulation, waitForSimulationFinished } from "../helpers/transfer/simulations";
import { buildTransferBody, transferAndWait, withRule } from "../helpers/transfer/transfers";

function expectNewestFirst(createdAt: string[]): void {
    const times = createdAt.map((c) => Date.parse(c));
    expect(times).toEqual([...times].sort((a, b) => b - a));
}

test.describe("GET /transfers", { tag: ["@transfer", "@spec:criar-transferencia"] }, () => {
    test("TRF-30: Filtro por simulationId devolve só as transferências da simulação, da mais nova para a mais antiga", async ({
        accountService,
        transferService,
    }) => {
        const accountIds = [await openAccountId(accountService), await openAccountId(accountService)];
        const simulationId = await startSimulation(transferService, { transfers: 4, minAmount: 0.01, maxAmount: 0.05, accountIds });
        const outsider = await transferService.PostTransfer(buildTransferBody(accountIds[0], accountIds[1], { amount: 0.01 }));
        expect(outsider.status, outsider.text).toBe(202);

        const res = await transferService.GetTransfers({ simulationId });
        expect(res.status, res.text).toBe(200);
        ContractValidator.validate(GetTransfersResponseSchema, res.body);
        expect(res.body).toHaveLength(4);
        expect(res.body.every((t) => t.simulationId === simulationId)).toBe(true);
        expect(res.body.map((t) => t.id)).not.toContain(outsider.body.id);
        expectNewestFirst(res.body.map((t) => t.createdAt));

        await waitForSimulationFinished(transferService, simulationId);
    });

    test("TRF-31: Filtro por status devolve só transferências nesse status", async ({ accountService, antifraudService, transferService }) => {
        const source = await openAccountId(accountService);
        const destination = await openAccountId(accountService);

        const rejected = await withRule(
            antifraudService,
            { decision: "Rejected", reason: "Filtro por status", sourceAccountIds: [source] },
            () => transferAndWait(transferService, buildTransferBody(source, destination), "FraudRejected")
        );

        await test.step("status FraudRejected inclui a transferência e nenhuma de outro status", async () => {
            const res = await transferService.GetTransfers({ status: "FraudRejected", take: 500 });
            expect(res.status, res.text).toBe(200);
            ContractValidator.validate(GetTransfersResponseSchema, res.body);
            expect(res.body.every((t) => t.status === "FraudRejected")).toBe(true);
            expect(res.body.map((t) => t.id)).toContain(rejected.id);
            expectNewestFirst(res.body.map((t) => t.createdAt));
        });

        await test.step("status Completed não inclui a transferência", async () => {
            const res = await transferService.GetTransfers({ status: "Completed", take: 500 });
            expect(res.status, res.text).toBe(200);
            expect(res.body.every((t) => t.status === "Completed")).toBe(true);
            expect(res.body.map((t) => t.id)).not.toContain(rejected.id);
        });
    });

    test("TRF-32: take padrão 50, limitado entre 1 e 500", async ({ accountService, transferService }) => {
        test.setTimeout(90_000);
        const accountIds = [
            await openAccountId(accountService, { initialDeposit: 10 }),
            await openAccountId(accountService, { initialDeposit: 10 }),
        ];
        const simulationId = await startSimulation(transferService, { transfers: 60, minAmount: 0.01, maxAmount: 0.01, accountIds });
        const all = await listSimulationTransfers(transferService, simulationId);
        expect(all).toHaveLength(60);

        const variations = [
            { label: "sem take: 50", take: undefined, expected: 50 },
            { label: "take 1", take: 1, expected: 1 },
            { label: "take 0 vira 1", take: 0, expected: 1 },
            { label: "take negativo vira 1", take: -5, expected: 1 },
            { label: "take 59", take: 59, expected: 59 },
            { label: "take acima de 500 vira 500 (60 existentes)", take: 1000, expected: 60 },
        ];
        for (const v of variations) {
            await test.step(v.label, async () => {
                const res = await transferService.GetTransfers({ simulationId, take: v.take });
                expect(res.status, res.text).toBe(200);
                expect(res.body).toHaveLength(v.expected);
                const ids = new Set(all.map((t) => t.id));
                expect(res.body.every((t) => ids.has(t.id))).toBe(true);
                expectNewestFirst(res.body.map((t) => t.createdAt));
            });
        }

        await test.step("sem filtros, take acima de 500 devolve no máximo 500", async () => {
            const res = await transferService.GetTransfers({ take: 501 });
            expect(res.status, res.text).toBe(200);
            expect(res.body.length).toBeLessThanOrEqual(500);
        });

        await waitForSimulationFinished(transferService, simulationId);
    });
});
