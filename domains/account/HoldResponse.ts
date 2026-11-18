import { HoldStatus } from "./HoldStatus";

export type HoldResponse = {
    holdId: string,
    accountId: string,
    reference: string,
    amount: number,
    reason: string,
    status: HoldStatus,
    createdAt: string,
    expiresAt: string | null,
    releasedAt: string | null
}
