export const ACCOUNT_STATUSES = ["Active", "Blocked", "Closed"] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
