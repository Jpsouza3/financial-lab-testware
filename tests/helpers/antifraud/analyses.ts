import { randomUUID } from "node:crypto";
import { HttpResponse } from "../../../core/http/HttpResponse";
import { ContractValidator } from "../../../core/schema/ContractValidator";
import { AnalysisResponse } from "../../../domains/antifraud/AnalysisResponse";
import { AnalysisResponseSchema } from "../../../domains/antifraud/AnalysisResponseSchema";
import { PostAnalysisBody } from "../../../domains/antifraud/PostAnalysisBody";
import { expect } from "../../../fixtures/ApiFixtures";
import { AntifraudInterface } from "../../../interfaces/AntifraudInterface";

export const CALLBACK = {
    transferUnknown: "http://transfer-api:8080/webhooks/antifraud",
    unreachable: "http://localhost:9/webhook",
} as const;

export const DEFAULT_DELAY_MS = 300;

export function uniqueTransactionId(): string {
    return `af-tx-${randomUUID()}`;
}

export function buildAnalysisBody(overrides: Partial<PostAnalysisBody> = {}): PostAnalysisBody {
    return {
        transactionId: uniqueTransactionId(),
        amount: 10,
        sourceAccountId: randomUUID(),
        destinationAccountId: randomUUID(),
        description: null,
        callbackUrl: CALLBACK.transferUnknown,
        ...overrides,
    };
}

export function invalidAnalysisBody(body: Record<string, unknown>): PostAnalysisBody {
    return body as unknown as PostAnalysisBody;
}

export function expectAnalysisAccepted(res: HttpResponse<AnalysisResponse>, body: PostAnalysisBody): AnalysisResponse {
    expect(res.status, res.text).toBe(202);
    ContractValidator.validate(AnalysisResponseSchema, res.body);
    const analysis = res.body;
    expect(res.headers["location"]).toBe(`/analyses/${analysis.id}`);
    expect(analysis).toMatchObject({
        transactionId: body.transactionId,
        status: "Pending",
        reason: null,
        ruleId: null,
        amount: body.amount,
        sourceAccountId: body.sourceAccountId,
        destinationAccountId: body.destinationAccountId,
        description: body.description ?? null,
        decidedAt: null,
    });
    expect(analysis.createdAt).toMatch(/Z$/);
    return analysis;
}

export async function submitAnalysis(
    antifraudService: AntifraudInterface,
    overrides: Partial<PostAnalysisBody> = {}
): Promise<AnalysisResponse> {
    const body = buildAnalysisBody(overrides);
    const res = await antifraudService.PostAnalysis(body);
    expect(res.status, `POST /analyses ${body.transactionId}: ${res.text}`).toBe(202);
    ContractValidator.validate(AnalysisResponseSchema, res.body);
    return res.body;
}

export async function getAnalysis(antifraudService: AntifraudInterface, analysisId: string): Promise<AnalysisResponse> {
    const res = await antifraudService.GetAnalysis(analysisId);
    expect(res.status, `GET /analyses/${analysisId}: ${res.text}`).toBe(200);
    ContractValidator.validate(AnalysisResponseSchema, res.body);
    return res.body;
}

export async function waitForDecision(
    antifraudService: AntifraudInterface,
    analysisId: string,
    timeout = 15_000
): Promise<AnalysisResponse> {
    let last: AnalysisResponse | undefined;
    await expect
        .poll(
            async () => {
                last = await getAnalysis(antifraudService, analysisId);
                return last.status;
            },
            { message: `análise ${analysisId} deveria ser decidida`, timeout, intervals: [100, 200, 500] }
        )
        .not.toBe("Pending");
    return last!;
}

export async function waitForWebhookDone(
    antifraudService: AntifraudInterface,
    analysisId: string,
    minAttempts = 0,
    timeout = 20_000
): Promise<AnalysisResponse> {
    let last: AnalysisResponse | undefined;
    await expect
        .poll(
            async () => {
                last = await getAnalysis(antifraudService, analysisId);
                return last.webhook.status !== "Pending" && last.webhook.attempts.length >= minAttempts;
            },
            { message: `webhook da análise ${analysisId} deveria terminar`, timeout, intervals: [200, 500] }
        )
        .toBe(true);
    return last!;
}

export async function decide(
    antifraudService: AntifraudInterface,
    overrides: Partial<PostAnalysisBody> = {}
): Promise<AnalysisResponse> {
    const submitted = await submitAnalysis(antifraudService, overrides);
    return waitForDecision(antifraudService, submitted.id);
}

export function expectApprovedWithoutRule(analysis: AnalysisResponse): void {
    expect(analysis).toMatchObject({ status: "Approved", reason: null, ruleId: null });
}

export function expectRejectedBy(analysis: AnalysisResponse, ruleId: string, reason?: string): void {
    expect(analysis).toMatchObject({ status: "Rejected", ruleId, reason: reason ?? `Recusada pela regra ${ruleId}.` });
}

export async function waitForAnalysisOfTransaction(
    antifraudService: AntifraudInterface,
    transactionId: string,
    timeout = 30_000
): Promise<AnalysisResponse> {
    let last: AnalysisResponse | undefined;
    await expect
        .poll(
            async () => {
                last = (await antifraudService.GetAnalyses({ transactionId })).body[0];
                return last !== undefined && last.webhook.status !== "Pending";
            },
            { message: `análise da transação ${transactionId} deveria terminar`, timeout, intervals: [200, 500, 1_000] }
        )
        .toBe(true);
    ContractValidator.validate(AnalysisResponseSchema, last);
    return last!;
}
