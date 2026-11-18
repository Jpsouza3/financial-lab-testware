import { EntryType } from "./EntryType";
import { StatementItem } from "./StatementItem";
import { StatementSummary } from "./StatementSummary";

export type GetStatementResponse = {
    accountId: string,
    from: string,
    to: string,
    type: EntryType | null,
    page: number,
    pageSize: number,
    totalItems: number,
    totalPages: number,
    summary: StatementSummary,
    items: StatementItem[]
}
