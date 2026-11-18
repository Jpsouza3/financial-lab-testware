import { DeliveryMode } from "./DeliveryMode";
import { FraudDecision } from "./FraudDecision";

export type FraudRule = {
    id: string,
    enabled: boolean,
    decision: FraudDecision,
    reason: string | null,
    minAmount: number | null,
    maxAmount: number | null,
    sourceAccountIds: string[] | null,
    destinationAccountIds: string[] | null,
    descriptionContains: string | null,
    delayMs: number | null,
    delivery: DeliveryMode,
    submitFailures: number
}
