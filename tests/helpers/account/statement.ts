import { ContractValidator } from "../../../core/schema/ContractValidator";
import { GetStatementQuery } from "../../../domains/account/GetStatementQuery";
import { GetStatementResponse } from "../../../domains/account/GetStatementResponse";
import { GetStatementResponseSchema } from "../../../domains/account/GetStatementResponseSchema";
import { expect } from "../../../fixtures/ApiFixtures";
import { AccountInterface } from "../../../interfaces/AccountInterface";

const DAY = 24 * 60 * 60 * 1000;

/** Data de hoje em UTC (`yyyy-MM-dd`). */
export function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

/** Soma `days` (pode ser negativo) a uma data `yyyy-MM-dd`. */
export function shiftDate(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Extrato com 200 + contrato. */
export async function getStatement(
    accountService: AccountInterface,
    accountId: string,
    query: GetStatementQuery = {}
): Promise<GetStatementResponse> {
    const res = await accountService.GetStatement(accountId, query);
    expect(res.status, `GET statement ${JSON.stringify(query)}: ${res.text}`).toBe(200);
    ContractValidator.validate(GetStatementResponseSchema, res.body);
    return res.body;
}
