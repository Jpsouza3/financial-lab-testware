export const WEBHOOK_STATUSES = ["Pending", "Delivered", "Failed", "Skipped"] as const;

export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];
