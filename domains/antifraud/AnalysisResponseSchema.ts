import { arrayOf, defineSchema } from "../../core/schema/Schema";
import { AnalysisResponse } from "./AnalysisResponse";
import { ANALYSIS_STATUSES } from "./AnalysisStatus";
import { AnalysisWebhook } from "./AnalysisWebhook";
import { DeliveryAttempt } from "./DeliveryAttempt";
import { DELIVERY_MODES } from "./DeliveryMode";
import { WEBHOOK_STATUSES } from "./WebhookStatus";

export const DeliveryAttemptSchema = defineSchema<DeliveryAttempt>()({
    type: "object",
    properties: {
        deliveryId: { type: "string", format: "uuid" },
        attempt: { type: "integer", minimum: 1 },
        decision: { type: "string", enum: ANALYSIS_STATUSES },
        statusCode: { type: "integer", nullable: true },
        error: { type: "string", nullable: true },
        at: { type: "string", format: "date-time" },
    },
    required: ["deliveryId", "attempt", "decision", "statusCode", "error", "at"],
    additionalProperties: false,
});

export const AnalysisWebhookSchema = defineSchema<AnalysisWebhook>()({
    type: "object",
    properties: {
        mode: { type: "string", enum: DELIVERY_MODES },
        status: { type: "string", enum: WEBHOOK_STATUSES },
        attempts: arrayOf(DeliveryAttemptSchema),
    },
    required: ["mode", "status", "attempts"],
    additionalProperties: false,
});

export const AnalysisResponseSchema = defineSchema<AnalysisResponse>()({
    type: "object",
    properties: {
        id: { type: "string", format: "uuid" },
        transactionId: { type: "string", minLength: 1, maxLength: 64 },
        status: { type: "string", enum: ANALYSIS_STATUSES },
        reason: { type: "string", nullable: true },
        ruleId: { type: "string", nullable: true },
        amount: { type: "number", exclusiveMinimum: 0 },
        sourceAccountId: { type: "string", format: "uuid" },
        destinationAccountId: { type: "string", format: "uuid" },
        description: { type: "string", nullable: true },
        createdAt: { type: "string", format: "date-time" },
        decidedAt: { type: "string", format: "date-time", nullable: true },
        webhook: AnalysisWebhookSchema,
    },
    required: [
        "id", "transactionId", "status", "reason", "ruleId", "amount", "sourceAccountId",
        "destinationAccountId", "description", "createdAt", "decidedAt", "webhook",
    ],
    additionalProperties: false,
});

export const AnalysisListSchema = arrayOf(AnalysisResponseSchema);
