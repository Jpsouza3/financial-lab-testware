import { HttpResponse } from "../../../core/http/HttpResponse";
import { ContractValidator } from "../../../core/schema/ContractValidator";
import { ProblemDetailsSchema } from "../../../domains/common/ProblemDetailsSchema";
import { expect } from "../../../fixtures/ApiFixtures";

/** Erro no formato problem+json (RFC 9457) com o status e o `detail` da regra. */
export function expectProblem(res: HttpResponse<unknown>, status: number, detail: string): void {
    expect(res.status, res.text).toBe(status);
    expect(res.headers["content-type"] ?? "").toContain("application/problem+json");
    ContractValidator.validate(ProblemDetailsSchema, res.body);
    expect(res.body.detail).toBe(detail);
}
