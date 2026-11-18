import { defineSchema } from "../../core/schema/Schema";
import { AccountResponse } from "./AccountResponse";
import { ACCOUNT_STATUSES } from "./AccountStatus";

export const AccountResponseSchema = defineSchema<AccountResponse>()({
    type: "object",
    properties: {
        accountId: { type: "string", format: "uuid" },
        name: { type: "string", minLength: 3, maxLength: 150 },
        document: { type: "string", pattern: "^[0-9]{11}$" },
        branch: { type: "string", pattern: "^[0-9]{4}$" },
        number: { type: "string", pattern: "^[0-9]{5}$" },
        status: { type: "string", enum: ACCOUNT_STATUSES },
        statusReason: { type: "string", nullable: true },
        balance: { type: "number" },
        blockedBalance: { type: "number" },
        availableBalance: { type: "number" },
        openedAt: { type: "string", format: "date-time" },
    },
    required: [
        "accountId", "name", "document", "branch", "number", "status", "statusReason",
        "balance", "blockedBalance", "availableBalance", "openedAt",
    ],
    additionalProperties: false,
});
