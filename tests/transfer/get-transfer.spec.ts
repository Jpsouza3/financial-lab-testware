/**
 * Criar Transferência (v1.0.0) — GET /transfers/{transferId}
 *
 * Regra: 200 devolve a transferência no estado atual; id inexistente responde 404 sem corpo.
 */
import { randomUUID } from "node:crypto";
import { ContractValidator } from "../../core/schema/ContractValidator";
import { TransferResponseSchema } from "../../domains/transfer/TransferResponseSchema";
import { expect, test } from "../../fixtures/ApiFixtures";
import { openAccountId } from "../helpers/account/accounts";
import { buildTransferBody, createTransfer, expectNoLegs, FAILURE_REASON, waitForTransferStatus, withRule } from "../helpers/transfer/transfers";

test.describe("GET /transfers/{transferId}", { tag: ["@transfer", "@spec:criar-transferencia"] }, () => {
    test("TRF-28: Devolve a transferência criada com os mesmos dados do 202", async ({
        accountService,
        antifraudService,
        transferService,
    }) => {
        const source = await openAccountId(accountService);
        const destination = await openAccountId(accountService);

        await withRule(antifraudService, { decision: "Rejected", reason: "Consulta por id", delayMs: 3_000, sourceAccountIds: [source] }, async () => {
            const created = await createTransfer(transferService, buildTransferBody(source, destination, { amount: 0.75 }));

            await test.step("enquanto aguarda o antifraude, GET devolve o mesmo corpo do 202", async () => {
                const res = await transferService.GetTransfer(created.id);
                expect(res.status, res.text).toBe(200);
                ContractValidator.validate(TransferResponseSchema, res.body);
                expect(res.body).toEqual(created);
            });

            await test.step("depois da decisão, GET devolve o status final com os mesmos ids", async () => {
                const final = await waitForTransferStatus(transferService, created.id, "FraudRejected");
                expectNoLegs(final, "FraudRejected", "Consulta por id");
                expect(final).toMatchObject({ id: created.id, endToEndId: created.endToEndId, createdAt: created.createdAt });
            });
        });
    });

    test("TRF-29: Transferência inexistente responde 404 sem corpo", async ({ transferService }) => {
        for (const id of [randomUUID(), "00000000-0000-0000-0000-000000000000", "nao-e-guid"]) {
            await test.step(id, async () => {
                const res = await transferService.GetTransfer(id);
                expect(res.status, res.text).toBe(404);
                expect(res.text).toBe("");
            });
        }
    });
});
