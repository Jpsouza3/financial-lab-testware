import { defineSchema } from "../../core/schema/Schema";
import { PostSimulationResponse } from "./PostSimulationResponse";

export const PostSimulationResponseSchema = defineSchema<PostSimulationResponse>()({
    type: "object",
    properties: {
        simulationId: { type: "string", format: "uuid" },
    },
    required: ["simulationId"],
    additionalProperties: false,
});
