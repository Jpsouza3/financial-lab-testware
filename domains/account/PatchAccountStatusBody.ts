import { AccountStatus } from "./AccountStatus";

export type PatchAccountStatusBody = {
    status: AccountStatus,
    reason?: string | null
}
