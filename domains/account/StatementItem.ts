import { EntryType } from "./EntryType";

export type StatementItem = {
    entryId: string,
    type: EntryType,
    amount: number,
    balanceAfter: number,
    endToEndId: string,
    description: string | null,
    createdAt: string
}
