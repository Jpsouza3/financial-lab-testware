export const FRAUD_DECISIONS = ["Approved", "Rejected"] as const;

export type FraudDecision = (typeof FRAUD_DECISIONS)[number];
