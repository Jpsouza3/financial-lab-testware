import { AccountStatus } from "./AccountStatus";

export type GetBalanceResponse = {
    accountId: string,
    status: AccountStatus,
    balance: number,
    blockedBalance: number,
    availableBalance: number,
    version: number
}
