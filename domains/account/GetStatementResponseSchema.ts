import { arrayOf, defineSchema } from "../../core/schema/Schema";
import { ENTRY_TYPES } from "./EntryType";
import { GetStatementResponse } from "./GetStatementResponse";
import { StatementItem } from "./StatementItem";
import { StatementSummary } from "./StatementSummary";

export const StatementSummarySchema = defineSchema<StatementSummary>()({
    type: "object",
    properties: {
        openingBalance: { type: "number" },
        closingBalance: { type: "number" },
        totalCredits: { type: "number", minimum: 0 },
        totalDebits: { type: "number", minimum: 0 },
        net: { type: "number" },
    },
    required: ["openingBalance", "closingBalance", "totalCredits", "totalDebits", "net"],
    additionalProperties: false,
});

export const StatementItemSchema = defineSchema<StatementItem>()({
    type: "object",
    properties: {
        entryId: { type: "string", format: "uuid" },
        type: { type: "string", enum: ENTRY_TYPES },
        amount: { type: "number", exclusiveMinimum: 0 },
        balanceAfter: { type: "number" },
        endToEndId: { type: "string", minLength: 1 },
        description: { type: "string", nullable: true },
        createdAt: { type: "string", format: "date-time" },
    },
    required: ["entryId", "type", "amount", "balanceAfter", "endToEndId", "description", "createdAt"],
    additionalProperties: false,
});

export const GetStatementResponseSchema = defineSchema<GetStatementResponse>()({
    type: "object",
    properties: {
        accountId: { type: "string", format: "uuid" },
        from: { type: "string", format: "date" },
        to: { type: "string", format: "date" },
        type: { type: "string", enum: [...ENTRY_TYPES, null], nullable: true },
        page: { type: "integer", minimum: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        totalItems: { type: "integer", minimum: 0 },
        totalPages: { type: "integer", minimum: 0 },
        summary: StatementSummarySchema,
        items: arrayOf(StatementItemSchema),
    },
    required: ["accountId", "from", "to", "type", "page", "pageSize", "totalItems", "totalPages", "summary", "items"],
    additionalProperties: false,
});
