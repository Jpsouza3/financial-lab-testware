/**
 * Abrir Conta (v1.0.0) — GET /accounts/{accountId} (rota auxiliar de verificação)
 *
 * Regra: devolve o mesmo corpo da abertura, com status e saldos atualizados. Conta inexistente: 404.
 *
 * Contas: cada teste abre as próprias contas pela API (tests/helpers/account/accounts.ts).
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "../../fixtures/ApiFixtures";
import { getAccount, openAccount } from "../helpers/account/accounts";
import { cents, createHold } from "../helpers/account/holds";
import { expectProblem } from "../helpers/common/problem";

test.describe("GET /accounts/{accountId}", { tag: ["@account", "@spec:abrir-conta"] }, () => {
    test("OPN-25: Conta devolve os dados da abertura", async ({ accountService }) => {
        const opened = await openAccount(accountService, { initialDeposit: 42.5, branch: "0002", name: "Carla Souza" });

        expect(await getAccount(accountService, opened.accountId)).toEqual(opened);
    });

    test("OPN-26: Conta devolve saldos e status atualizados", async ({ accountService }) => {
        const opened = await openAccount(accountService, { initialDeposit: 100 });
        await createHold(accountService, opened.accountId, { amount: 30.25 });
        const change = await accountService.PatchAccountStatus(opened.accountId, { status: "Blocked", reason: "Análise cadastral" });
        expect(change.status, change.text).toBe(200);

        const account = await getAccount(accountService, opened.accountId);

        expect(account).toMatchObject({
            accountId: opened.accountId,
            name: opened.name,
            document: opened.document,
            branch: opened.branch,
            number: opened.number,
            openedAt: opened.openedAt,
            status: "Blocked",
            statusReason: "Análise cadastral",
        });
        expect(account.balance).toBeCloseTo(100, 2);
        expect(account.blockedBalance).toBeCloseTo(30.25, 2);
        expect(account.availableBalance).toBeCloseTo(cents(100 - 30.25), 2);
    });

    test("OPN-27: Conta inexistente", async ({ accountService }) => {
        expectProblem(await accountService.GetAccount(randomUUID()), 404, "Conta não encontrada.");
    });
});
