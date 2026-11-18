import { defineSchema } from "../../core/schema/Schema";
import { ACCOUNT_STATUSES } from "./AccountStatus";
import { GetBalanceResponse } from "./GetBalanceResponse";

export const GetBalanceResponseSchema = defineSchema<GetBalanceResponse>()({
    type: "object",
    properties: {
        accountId: { type: "string", format: "uuid" },
        status: { type: "string", enum: ACCOUNT_STATUSES },
        balance: { type: "number" },
        blockedBalance: { type: "number" },
        availableBalance: { type: "number" },
        version: { type: "integer", minimum: 0 },
    },
    required: ["accountId", "status", "balance", "blockedBalance", "availableBalance", "version"],
    additionalProperties: false,
});
