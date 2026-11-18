import { arrayOf, defineSchema } from "../../core/schema/Schema";
import { DELIVERY_MODES } from "./DeliveryMode";
import { FRAUD_DECISIONS } from "./FraudDecision";
import { FraudRule } from "./FraudRule";

const guidList = { type: "array", items: { type: "string", format: "uuid" }, nullable: true };

export const FraudRuleSchema = defineSchema<FraudRule>()({
    type: "object",
    properties: {
        id: { type: "string", minLength: 1, maxLength: 64 },
        enabled: { type: "boolean" },
        decision: { type: "string", enum: FRAUD_DECISIONS },
        reason: { type: "string", nullable: true },
        minAmount: { type: "number", minimum: 0, nullable: true },
        maxAmount: { type: "number", minimum: 0, nullable: true },
        sourceAccountIds: guidList,
        destinationAccountIds: guidList,
        descriptionContains: { type: "string", nullable: true },
        delayMs: { type: "integer", minimum: 0, maximum: 120000, nullable: true },
        delivery: { type: "string", enum: DELIVERY_MODES },
        submitFailures: { type: "integer", minimum: 0, maximum: 20 },
    },
    required: [
        "id", "enabled", "decision", "reason", "minAmount", "maxAmount", "sourceAccountIds",
        "destinationAccountIds", "descriptionContains", "delayMs", "delivery", "submitFailures",
    ],
    additionalProperties: false,
});

export const FraudRuleListSchema = arrayOf(FraudRuleSchema);
