import { defineSchema } from "../../core/schema/Schema";
import { ACCOUNT_STATUSES } from "./AccountStatus";
import { PatchAccountStatusResponse } from "./PatchAccountStatusResponse";

export const PatchAccountStatusResponseSchema = defineSchema<PatchAccountStatusResponse>()({
    type: "object",
    properties: {
        accountId: { type: "string", format: "uuid" },
        previousStatus: { type: "string", enum: ACCOUNT_STATUSES },
        status: { type: "string", enum: ACCOUNT_STATUSES },
        reason: { type: "string", nullable: true },
        changedAt: { type: "string", format: "date-time", nullable: true },
        changed: { type: "boolean" },
    },
    required: ["accountId", "previousStatus", "status", "reason", "changedAt", "changed"],
    additionalProperties: false,
});
