export const DELIVERY_MODES = ["Normal", "Duplicate", "Drop", "InvalidSignature", "Flip"] as const;

export type DeliveryMode = (typeof DELIVERY_MODES)[number];
