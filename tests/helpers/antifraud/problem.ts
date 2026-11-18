import { HttpResponse } from "../../../core/http/HttpResponse";
import { ContractValidator } from "../../../core/schema/ContractValidator";
import { ValidationProblemSchema } from "../../../domains/antifraud/ValidationProblemSchema";
import { expect } from "../../../fixtures/ApiFixtures";

export function expectValidationProblem(res: HttpResponse<unknown>, errors: Record<string, string[]>): void {
    expect(res.status, res.text).toBe(400);
    expect(res.headers["content-type"] ?? "").toContain("application/problem+json");
    ContractValidator.validate(ValidationProblemSchema, res.body);
    expect(res.body.errors).toEqual(errors);
}

export function expectBadRequest(res: HttpResponse<unknown>): void {
    expect(res.status, res.text).toBe(400);
}
