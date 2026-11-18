import { defineSchema } from "../../core/schema/Schema";
import { HoldResponse } from "./HoldResponse";
import { HOLD_STATUSES } from "./HoldStatus";

export const HoldResponseSchema = defineSchema<HoldResponse>()({
    type: "object",
    properties: {
        holdId: { type: "string", format: "uuid" },
        accountId: { type: "string", format: "uuid" },
        reference: { type: "string", minLength: 1, maxLength: 32 },
        amount: { type: "number", exclusiveMinimum: 0 },
        reason: { type: "string", minLength: 5, maxLength: 200 },
        status: { type: "string", enum: HOLD_STATUSES },
        createdAt: { type: "string", format: "date-time" },
        expiresAt: { type: "string", format: "date-time", nullable: true },
        releasedAt: { type: "string", format: "date-time", nullable: true },
    },
    required: ["holdId", "accountId", "reference", "amount", "reason", "status", "createdAt", "expiresAt", "releasedAt"],
    additionalProperties: false,
});
