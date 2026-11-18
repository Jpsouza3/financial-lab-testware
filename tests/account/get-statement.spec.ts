/**
 * Extrato da Conta (v1.0.0) — GET /accounts/{accountId}/statement
 *
 * Regra: lançamentos do período [from, to] (UTC, inclusivo; padrão: 30 dias até hoje), filtro opcional por tipo,
 * paginação (page ≥ 1, pageSize 1–100, padrão 20), itens do mais recente para o mais antigo, e resumo com
 * openingBalance, closingBalance, totalCredits, totalDebits e net. O filtro de tipo não afeta opening/closing.
 * Regras na ordem: data inválida, data final futura, from > to, período > 90 dias, tipo, página, tamanho (400),
 * conta inexistente (404).
 *
 * Contas: cada teste abre as próprias contas; débitos e créditos vêm de transferências (Transfer API, < 1000,00).
 * Fora do escopo (v1.0.0): openingBalance diferente de zero (exige lançamentos em dias anteriores; só as contas de
 * seed têm) e desempate por entryId (exige dois lançamentos com o mesmo createdAt).
 */
import { randomUUID } from "node:crypto";
import { GetStatementQuery } from "../../domains/account/GetStatementQuery";
import { GetStatementResponse } from "../../domains/account/GetStatementResponse";
import { TransferResponse } from "../../domains/transfer/TransferResponse";
import { expect, test } from "../../fixtures/ApiFixtures";
import { AccountInterface } from "../../interfaces/AccountInterface";
import { TransferInterface } from "../../interfaces/TransferInterface";
import { openAccountId } from "../helpers/account/accounts";
import { createHold, getBalance } from "../helpers/account/holds";
import { getStatement, shiftDate, todayUtc } from "../helpers/account/statement";
import { transferAndSettle } from "../helpers/account/transfers";
import { expectProblem } from "../helpers/common/problem";

const DETAIL = {
    date: "Data inválida. Use o formato yyyy-MM-dd.",
    future: "A data final não pode estar no futuro.",
    order: "A data inicial não pode ser posterior à data final.",
    period: "O período máximo é de 90 dias.",
    type: "Tipo inválido. Valores aceitos: Credit, Debit.",
    page: "A página deve ser maior ou igual a 1.",
    pageSize: "O tamanho da página deve estar entre 1 e 100.",
    accountNotFound: "Conta não encontrada.",
} as const;

type Movements = { accountId: string, debit: TransferResponse, credit: TransferResponse };

/**
 * Conta com 3 lançamentos, do mais antigo para o mais recente:
 * crédito 100,00 (depósito inicial, saldo 100,00) → débito 30,00 (saldo 70,00) → crédito 10,00 (saldo 80,00).
 */
async function accountWithMovements(accountService: AccountInterface, transferService: TransferInterface): Promise<Movements> {
    const accountId = await openAccountId(accountService, { initialDeposit: 100 });
    const other = await openAccountId(accountService, { initialDeposit: 50 });
    const debit = await transferAndSettle(transferService, accountId, other, 30);
    expect(debit.status, debit.failureReason ?? "").toBe("Completed");
    const credit = await transferAndSettle(transferService, other, accountId, 10);
    expect(credit.status, credit.failureReason ?? "").toBe("Completed");
    return { accountId, debit, credit };
}

function expectSummary(statement: GetStatementResponse, expected: GetStatementResponse["summary"]): void {
    const { summary } = statement;
    expect(summary.openingBalance).toBeCloseTo(expected.openingBalance, 2);
    expect(summary.closingBalance).toBeCloseTo(expected.closingBalance, 2);
    expect(summary.totalCredits).toBeCloseTo(expected.totalCredits, 2);
    expect(summary.totalDebits).toBeCloseTo(expected.totalDebits, 2);
    expect(summary.net).toBeCloseTo(expected.net, 2);
}

test.describe("GET /accounts/{accountId}/statement", { tag: ["@account", "@spec:extrato-conta"] }, () => {
    test.describe("consulta", () => {
        test("STM-01: Extrato sem parâmetros usa os padrões", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 75.5 });
            const today = todayUtc();

            const statement = await getStatement(accountService, accountId);

            expect(statement).toMatchObject({
                accountId,
                from: shiftDate(today, -29),
                to: today,
                type: null,
                page: 1,
                pageSize: 20,
                totalItems: 1,
                totalPages: 1,
            });
            expectSummary(statement, { openingBalance: 0, closingBalance: 75.5, totalCredits: 75.5, totalDebits: 0, net: 75.5 });
            expect(statement.items).toHaveLength(1);
            expect(statement.items[0]).toMatchObject({ type: "Credit", amount: 75.5, balanceAfter: 75.5, description: "Depósito inicial" });
        });

        test("STM-02: Débitos e créditos de transferências em ordem decrescente", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const { accountId, debit, credit } = await accountWithMovements(accountService, transferService);

            const statement = await getStatement(accountService, accountId);

            expect(statement.totalItems).toBe(3);
            expect(statement.totalPages).toBe(1);
            expect(statement.items.map((i) => [i.type, i.amount, i.balanceAfter])).toEqual([
                ["Credit", 10, 80],
                ["Debit", 30, 70],
                ["Credit", 100, 100],
            ]);
            expect(statement.items[0].endToEndId).toBe(credit.endToEndId);
            expect(statement.items[1].endToEndId).toBe(debit.endToEndId);
            expect(statement.items[0].entryId).toBe(credit.credit?.entryId);
            expect(statement.items[1].entryId).toBe(debit.debit?.entryId);
            const createdAt = statement.items.map((i) => Date.parse(i.createdAt));
            expect([...createdAt].sort((a, b) => b - a)).toEqual(createdAt);
            expectSummary(statement, { openingBalance: 0, closingBalance: 80, totalCredits: 110, totalDebits: 30, net: 80 });
        });

        test("STM-03: Filtro Debit afeta itens e totais, mas não os saldos de abertura e fechamento", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const { accountId, debit } = await accountWithMovements(accountService, transferService);

            const statement = await getStatement(accountService, accountId, { type: "Debit" });

            expect(statement).toMatchObject({ type: "Debit", totalItems: 1, totalPages: 1 });
            expect(statement.items.map((i) => i.endToEndId)).toEqual([debit.endToEndId]);
            expect(statement.items[0]).toMatchObject({ type: "Debit", amount: 30 });
            expectSummary(statement, { openingBalance: 0, closingBalance: 80, totalCredits: 0, totalDebits: 30, net: -30 });
        });

        test("STM-04: Filtro Credit afeta itens e totais, mas não os saldos de abertura e fechamento", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const { accountId } = await accountWithMovements(accountService, transferService);

            const statement = await getStatement(accountService, accountId, { type: "Credit" });

            expect(statement).toMatchObject({ type: "Credit", totalItems: 2, totalPages: 1 });
            expect(statement.items.map((i) => [i.type, i.amount])).toEqual([["Credit", 10], ["Credit", 100]]);
            expectSummary(statement, { openingBalance: 0, closingBalance: 80, totalCredits: 110, totalDebits: 0, net: 110 });
        });

        test("STM-05: Total de itens que não é múltiplo do tamanho da página", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const { accountId } = await accountWithMovements(accountService, transferService);

            const first = await test.step("página 1 de 2", async () => {
                const page = await getStatement(accountService, accountId, { pageSize: 2, page: 1 });
                expect(page).toMatchObject({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
                expect(page.items.map((i) => i.amount)).toEqual([10, 30]);
                return page;
            });

            await test.step("página 2 de 2 traz o item restante", async () => {
                const page = await getStatement(accountService, accountId, { pageSize: 2, page: 2 });
                expect(page).toMatchObject({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
                expect(page.items.map((i) => i.amount)).toEqual([100]);
                expect(page.summary).toEqual(first.summary);
            });
        });

        test("STM-06: pageSize 1 pagina um lançamento por página na ordem decrescente", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const { accountId, debit, credit } = await accountWithMovements(accountService, transferService);

            const pages = [];
            for (const page of [1, 2, 3]) pages.push(await getStatement(accountService, accountId, { pageSize: 1, page }));

            for (const p of pages) expect(p).toMatchObject({ totalItems: 3, totalPages: 3 });
            expect(pages.map((p) => p.items.map((i) => i.endToEndId))).toEqual([
                [credit.endToEndId],
                [debit.endToEndId],
                [expect.stringMatching(/^OPEN\d{9}$/)],
            ]);
        });

        test("STM-07: Página além da última devolve itens vazios e totais preenchidos", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const { accountId } = await accountWithMovements(accountService, transferService);

            const statement = await getStatement(accountService, accountId, { pageSize: 2, page: 3 });

            expect(statement).toMatchObject({ page: 3, pageSize: 2, totalItems: 3, totalPages: 2, items: [] });
            expectSummary(statement, { openingBalance: 0, closingBalance: 80, totalCredits: 110, totalDebits: 30, net: 80 });
        });

        test("STM-08: Conta sem lançamentos", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 0 });

            const statement = await getStatement(accountService, accountId);

            expect(statement).toMatchObject({ totalItems: 0, totalPages: 0, items: [] });
            expectSummary(statement, { openingBalance: 0, closingBalance: 0, totalCredits: 0, totalDebits: 0, net: 0 });
        });

        test("STM-09: Período sem lançamentos fecha com o saldo de abertura", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 40 });
            const yesterday = shiftDate(todayUtc(), -1);

            const statement = await getStatement(accountService, accountId, { from: shiftDate(yesterday, -5), to: yesterday });

            expect(statement).toMatchObject({ from: shiftDate(yesterday, -5), to: yesterday, totalItems: 0, totalPages: 0, items: [] });
            expectSummary(statement, { openingBalance: 0, closingBalance: 0, totalCredits: 0, totalDebits: 0, net: 0 });
        });

        test("STM-10: Período de um dia (from = to = hoje) inclui os lançamentos do dia", async ({ accountService }) => {
            const accountId = await openAccountId(accountService, { initialDeposit: 40 });
            const today = todayUtc();

            const statement = await getStatement(accountService, accountId, { from: today, to: today });

            expect(statement).toMatchObject({ from: today, to: today, totalItems: 1 });
            expectSummary(statement, { openingBalance: 0, closingBalance: 40, totalCredits: 40, totalDebits: 0, net: 40 });
        });

        test("STM-11: Padrões quando só from ou só to é informado", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const today = todayUtc();

            await test.step("só to: from = to − 29 dias", async () => {
                const to = shiftDate(today, -10);
                expect(await getStatement(accountService, accountId, { to })).toMatchObject({ from: shiftDate(to, -29), to });
            });

            await test.step("só from: to = hoje", async () => {
                const from = shiftDate(today, -5);
                expect(await getStatement(accountService, accountId, { from })).toMatchObject({ from, to: today });
            });

            await test.step("só from há 90 dias: 400 (91 dias até hoje)", async () => {
                expectProblem(await accountService.GetStatement(accountId, { from: shiftDate(today, -90) }), 400, DETAIL.period);
            });
        });

        test("STM-12: Conta Blocked ou Closed continua tendo extrato; bloqueios e status não aparecem", async ({ accountService }) => {
            const blocked = await openAccountId(accountService, { initialDeposit: 20 });
            await createHold(accountService, blocked, { amount: 5 });
            const change = await accountService.PatchAccountStatus(blocked, { status: "Blocked", reason: "Revisão cadastral" });
            expect(change.status, change.text).toBe(200);

            await test.step("conta Blocked com bloqueio: só o depósito inicial", async () => {
                const statement = await getStatement(accountService, blocked);
                expect(statement.totalItems).toBe(1);
                expectSummary(statement, { openingBalance: 0, closingBalance: 20, totalCredits: 20, totalDebits: 0, net: 20 });
            });

            await test.step("conta Closed: 200 sem lançamentos", async () => {
                const closed = await openAccountId(accountService, { initialDeposit: 0, status: "Closed" });
                expect((await getStatement(accountService, closed)).totalItems).toBe(0);
            });
        });

        test("STM-13: Débito recusado não gera lançamento", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const accountId = await openAccountId(accountService, { initialDeposit: 1 });
            const destination = await openAccountId(accountService, { initialDeposit: 0 });

            const transfer = await transferAndSettle(transferService, accountId, destination, 1.01);

            expect(transfer.status).toBe("Failed");
            const statement = await getStatement(accountService, accountId);
            expect(statement.totalItems).toBe(1);
            expectSummary(statement, { openingBalance: 0, closingBalance: 1, totalCredits: 1, totalDebits: 0, net: 1 });
            expect((await getStatement(accountService, destination)).totalItems).toBe(0);
        });
    });

    test.describe("concorrência", () => {
        test("STM-23: Créditos simultâneos na mesma conta geram lançamentos com saldos encadeados", async ({ accountService, transferService }) => {
            test.setTimeout(60_000);
            const destination = await openAccountId(accountService, { initialDeposit: 0 });
            const sources: string[] = [];
            for (let i = 0; i < 4; i++) sources.push(await openAccountId(accountService, { initialDeposit: 10 }));

            const transfers = await Promise.all(sources.map((source) => transferAndSettle(transferService, source, destination, 5)));

            for (const t of transfers) expect(t.status, t.failureReason ?? "").toBe("Completed");
            const balance = await getBalance(accountService, destination);
            expect(balance.balance).toBeCloseTo(20, 2);
            expect(balance.version).toBe(4);
            const statement = await getStatement(accountService, destination);
            expect(statement.totalItems).toBe(4);
            expect(statement.items.map((i) => i.balanceAfter)).toEqual([20, 15, 10, 5]);
            expect(new Set(statement.items.map((i) => i.endToEndId))).toEqual(new Set(transfers.map((t) => t.endToEndId)));
            expectSummary(statement, { openingBalance: 0, closingBalance: 20, totalCredits: 20, totalDebits: 0, net: 20 });
        });
    });

    test.describe("validação dos parâmetros", () => {
        test("STM-14: from ou to fora do formato yyyy-MM-dd ou inexistente", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const invalid = ["2026-02-30", "2025-02-29", "2026-13-01", "2026-1-05", "18/11/2026", "2026-11-18T00:00:00", "hoje"];
            for (const field of ["from", "to"] as const) {
                for (const value of invalid) {
                    await test.step(`400: ${field}=${value}`, async () => {
                        expectProblem(await accountService.GetStatement(accountId, { [field]: value }), 400, DETAIL.date);
                    });
                }
            }

            await test.step("controle 200: 2024-02-29 (ano bissexto)", async () => {
                const statement = await getStatement(accountService, accountId, { from: "2024-02-29", to: "2024-03-01" });
                expect(statement).toMatchObject({ from: "2024-02-29", to: "2024-03-01" });
            });
        });

        test("STM-15: Data final no futuro", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const today = todayUtc();

            for (const to of [shiftDate(today, 1), shiftDate(today, 400)]) {
                await test.step(`400: to=${to}`, async () => {
                    expectProblem(await accountService.GetStatement(accountId, { from: today, to }), 400, DETAIL.future);
                });
            }

            await test.step("controle 200: to = hoje", async () => {
                expect((await getStatement(accountService, accountId, { to: today })).to).toBe(today);
            });
        });

        test("STM-16: Data inicial posterior à final", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const today = todayUtc();

            expectProblem(await accountService.GetStatement(accountId, { from: today, to: shiftDate(today, -1) }), 400, DETAIL.order);
        });

        test("STM-17: Período máximo de 90 dias, contando from e to", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const today = todayUtc();

            await test.step("200: exatamente 90 dias até hoje", async () => {
                const from = shiftDate(today, -89);
                expect(await getStatement(accountService, accountId, { from, to: today })).toMatchObject({ from, to: today });
            });

            await test.step("400: 91 dias até hoje", async () => {
                expectProblem(await accountService.GetStatement(accountId, { from: shiftDate(today, -90), to: today }), 400, DETAIL.period);
            });

            await test.step("200: exemplo da spec 2026-08-16 a 2026-11-13", async () => {
                expect(await getStatement(accountService, accountId, { from: "2026-08-16", to: "2026-11-13" })).toMatchObject({
                    from: "2026-08-16",
                    to: "2026-11-13",
                });
            });

            await test.step("400: 2026-08-15 a 2026-11-13 (91 dias)", async () => {
                expectProblem(await accountService.GetStatement(accountId, { from: "2026-08-15", to: "2026-11-13" }), 400, DETAIL.period);
            });
        });

        test("STM-18: type fora de Credit ou Debit", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);

            for (const type of ["credit", "DEBIT", "Credito", "Hold", "Credit,Debit"]) {
                await test.step(`400: ${type}`, async () => {
                    expectProblem(await accountService.GetStatement(accountId, { type }), 400, DETAIL.type);
                });
            }
        });

        test("STM-19: page menor que 1 ou não inteira", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);

            for (const page of [0, -1, "abc", "1.5"]) {
                await test.step(`400: page=${page}`, async () => {
                    expectProblem(await accountService.GetStatement(accountId, { page }), 400, DETAIL.page);
                });
            }

            await test.step("controle 200: page=1", async () => {
                expect((await getStatement(accountService, accountId, { page: 1 })).page).toBe(1);
            });
        });

        test("STM-20: pageSize fora de 1 a 100", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);

            for (const pageSize of [0, -1, 101, 1000, "abc"]) {
                await test.step(`400: pageSize=${pageSize}`, async () => {
                    expectProblem(await accountService.GetStatement(accountId, { pageSize }), 400, DETAIL.pageSize);
                });
            }

            for (const pageSize of [1, 100]) {
                await test.step(`controle 200: pageSize=${pageSize}`, async () => {
                    expect((await getStatement(accountService, accountId, { pageSize })).pageSize).toBe(pageSize);
                });
            }
        });

        test("STM-21: Conta inexistente", async ({ accountService }) => {
            expectProblem(await accountService.GetStatement(randomUUID()), 404, DETAIL.accountNotFound);
        });

        test("STM-22: Ordem de avaliação das regras", async ({ accountService }) => {
            const accountId = await openAccountId(accountService);
            const today = todayUtc();
            const tomorrow = shiftDate(today, 1);
            const cases: { label: string; query: GetStatementQuery; detail: string }[] = [
                { label: "data inválida + to futuro", query: { from: "2026-02-30", to: tomorrow }, detail: DETAIL.date },
                { label: "to futuro + from > to", query: { from: shiftDate(tomorrow, 1), to: tomorrow }, detail: DETAIL.future },
                { label: "from > to + tipo inválido", query: { from: today, to: shiftDate(today, -1), type: "x" }, detail: DETAIL.order },
                { label: "91 dias + tipo inválido", query: { from: shiftDate(today, -90), to: today, type: "x" }, detail: DETAIL.period },
                { label: "tipo inválido + page 0", query: { type: "x", page: 0 }, detail: DETAIL.type },
                { label: "page 0 + pageSize 0", query: { page: 0, pageSize: 0 }, detail: DETAIL.page },
            ];
            for (const c of cases) {
                await test.step(`400: ${c.label}`, async () => {
                    expectProblem(await accountService.GetStatement(accountId, c.query), 400, c.detail);
                });
            }

            await test.step("conta inexistente + pageSize 101: 400, não 404", async () => {
                expectProblem(await accountService.GetStatement(randomUUID(), { pageSize: 101 }), 400, DETAIL.pageSize);
            });
        });
    });
});
