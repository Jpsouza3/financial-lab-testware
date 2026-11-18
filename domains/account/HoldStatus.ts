export const HOLD_STATUSES = ["Active", "Released", "Expired"] as const;

export type HoldStatus = (typeof HOLD_STATUSES)[number];
