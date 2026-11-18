import { AccountStatus } from "./AccountStatus";

export type PatchAccountStatusResponse = {
    accountId: string,
    previousStatus: AccountStatus,
    status: AccountStatus,
    reason: string | null,
    changedAt: string | null,
    changed: boolean
}
