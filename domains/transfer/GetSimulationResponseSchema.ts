import { defineSchema } from "../../core/schema/Schema";
import { GetSimulationResponse } from "./GetSimulationResponse";
import { TRANSFER_STATUSES } from "./TransferStatus";

export const GetSimulationResponseSchema = defineSchema<GetSimulationResponse>()({
    type: "object",
    properties: {
        simulationId: { type: "string", format: "uuid" },
        total: { type: "integer", minimum: 1 },
        finished: { type: "boolean" },
        byStatus: {
            type: "object",
            propertyNames: { enum: TRANSFER_STATUSES },
            additionalProperties: { type: "integer", minimum: 1 },
            minProperties: 1,
        },
    },
    required: ["simulationId", "total", "finished", "byStatus"],
    additionalProperties: false,
});
