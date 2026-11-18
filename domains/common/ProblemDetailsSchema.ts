import { defineSchema } from "../../core/schema/Schema";
import { ProblemDetails } from "./ProblemDetails";

/** `detail` é obrigatório (é o que os testes afirmam); extensões são aceitas. */
export const ProblemDetailsSchema = defineSchema<ProblemDetails>()({
    type: "object",
    properties: {
        type: { type: "string" },
        title: { type: "string" },
        status: { type: "integer", minimum: 100, maximum: 599 },
        detail: { type: "string" },
        instance: { type: "string" },
    },
    required: ["detail"],
    additionalProperties: true,
});
