export const TRANSFER_STATUSES = [
    "Screening",
    "FraudRejected",
    "Debiting",
    "Crediting",
    "Completed",
    "Failed",
    "Refunding",
    "Refunded",
    "RefundFailed",
] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
