import { defineSchema } from "../../core/schema/Schema";
import { ValidationProblem } from "./ValidationProblem";

export const ValidationProblemSchema = defineSchema<ValidationProblem>()({
    type: "object",
    properties: {
        type: { type: "string" },
        title: { type: "string" },
        status: { type: "integer", const: 400 },
        errors: {
            type: "object",
            minProperties: 1,
            additionalProperties: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        traceId: { type: "string" },
    },
    required: ["status", "errors"],
    additionalProperties: true,
});
