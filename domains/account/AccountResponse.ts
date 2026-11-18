import { AccountStatus } from "./AccountStatus";

export type AccountResponse = {
    accountId: string,
    name: string,
    document: string,
    branch: string,
    number: string,
    status: AccountStatus,
    statusReason: string | null,
    balance: number,
    blockedBalance: number,
    availableBalance: number,
    openedAt: string
}
