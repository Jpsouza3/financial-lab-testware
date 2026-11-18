import { defineSchema, nullable } from "../../core/schema/Schema";
import { TransferLeg } from "./TransferLeg";
import { TransferResponse } from "./TransferResponse";
import { TRANSFER_STATUSES } from "./TransferStatus";

export const TransferLegSchema = defineSchema<TransferLeg>()({
    type: "object",
    properties: {
        accountId: { type: "string", format: "uuid" },
        endToEndId: { type: "string", minLength: 1 },
        entryId: { type: "string", format: "uuid" },
        occurredAt: { type: "string", format: "date-time" },
    },
    required: ["accountId", "endToEndId", "entryId", "occurredAt"],
    additionalProperties: false,
});

export const TransferResponseSchema = defineSchema<TransferResponse>()({
    type: "object",
    properties: {
        id: { type: "string", format: "uuid" },
        sourceAccountId: { type: "string", format: "uuid" },
        destinationAccountId: { type: "string", format: "uuid" },
        amount: { type: "number", exclusiveMinimum: 0 },
        description: { type: "string", nullable: true },
        endToEndId: { type: "string", minLength: 1 },
        refundEndToEndId: { type: "string", nullable: true },
        status: { type: "string", enum: TRANSFER_STATUSES },
        failureReason: { type: "string", nullable: true },
        simulationId: { type: "string", format: "uuid", nullable: true },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
        debit: nullable(TransferLegSchema),
        credit: nullable(TransferLegSchema),
        refund: nullable(TransferLegSchema),
    },
    required: [
        "id", "sourceAccountId", "destinationAccountId", "amount", "description", "endToEndId",
        "refundEndToEndId", "status", "failureReason", "simulationId", "createdAt", "updatedAt",
        "debit", "credit", "refund",
    ],
    additionalProperties: false,
});
