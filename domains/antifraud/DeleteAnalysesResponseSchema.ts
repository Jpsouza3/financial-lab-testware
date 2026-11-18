import { defineSchema } from "../../core/schema/Schema";
import { DeleteAnalysesResponse } from "./DeleteAnalysesResponse";

export const DeleteAnalysesResponseSchema = defineSchema<DeleteAnalysesResponse>()({
    type: "object",
    properties: {
        removed: { type: "integer", minimum: 0 },
    },
    required: ["removed"],
    additionalProperties: false,
});
