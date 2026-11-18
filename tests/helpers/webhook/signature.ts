import { createHmac, randomUUID } from "node:crypto";
import { HttpResponse } from "../../../core/http/HttpResponse";
import { WebhookAckResponse } from "../../../domains/transfer/WebhookAckResponse";
import { expect } from "../../../fixtures/ApiFixtures";
import { TransferInterface } from "../../../interfaces/TransferInterface";

/**
 * Webhook do antifraude enviado pelo próprio teste (POST /webhooks/antifraud na Transfer API).
 *
 * Assinatura: `sha256=` + HMAC-SHA256 em hex minúsculo de `<timestamp>.<corpo bruto>`.
 */

/** Segredo público do laboratório (docker-compose do SUT e appsettings.Development.json), não é credencial real. */
export const LAB_WEBHOOK_SECRET = "financial-lab-webhook-secret";

/** Tolerância de relógio da Transfer API (`Antifraud:SignatureToleranceSeconds`). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export const WEBHOOK_TITLE = {
    signature: "Assinatura inválida.",
    payload: "Payload inválido.",
} as const;

export type WebhookDecision = "Approved" | "Rejected";

export type WebhookPayload = {
    analysisId?: string,
    transactionId?: string,
    decision?: string,
    reason?: string | null,
    ruleId?: string | null,
    decidedAt?: string,
};

/**
 * Mesmo `Content-Type` que a Antifraud API envia. Com `application/json` exato o Playwright reserializa corpos que
 * não são JSON válido; com o charset o corpo vai byte a byte como foi assinado.
 */
export const WEBHOOK_CONTENT_TYPE = { "Content-Type": "application/json; charset=utf-8" } as const;

/** Unix time em segundos, deslocado de `offsetSeconds`. */
export function unixNow(offsetSeconds = 0): string {
    return String(Math.floor(Date.now() / 1000) + offsetSeconds);
}

export function hmacSha256Hex(message: string, secret = LAB_WEBHOOK_SECRET): string {
    return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

export function signWebhook(timestamp: string, rawBody: string, secret = LAB_WEBHOOK_SECRET): string {
    return "sha256=" + hmacSha256Hex(`${timestamp}.${rawBody}`, secret);
}

/** Corpo bruto no formato enviado pela Antifraud API. */
export function buildWebhookBody(transactionId: string, decision: WebhookDecision, reason: string | null = null): string {
    const payload: WebhookPayload = {
        analysisId: randomUUID(),
        transactionId,
        decision,
        reason,
        ruleId: null,
        decidedAt: new Date().toISOString(),
    };
    return JSON.stringify(payload);
}

/** Headers válidos para `rawBody` (timestamp atual + assinatura correta + id de entrega). */
export function signedHeaders(rawBody: string, timestamp = unixNow()): Record<string, string> {
    return {
        ...WEBHOOK_CONTENT_TYPE,
        "X-Antifraud-Timestamp": timestamp,
        "X-Antifraud-Signature": signWebhook(timestamp, rawBody),
        "X-Antifraud-Delivery": randomUUID(),
    };
}

/** Envia a decisão assinada corretamente. */
export function sendDecision(
    transferService: TransferInterface,
    transactionId: string,
    decision: WebhookDecision,
    reason: string | null = null
): Promise<HttpResponse<WebhookAckResponse>> {
    const body = buildWebhookBody(transactionId, decision, reason);
    return transferService.PostAntifraudWebhook(body, signedHeaders(body));
}

/** 200 com `{ transferId, status }` e nada além disso. */
export function expectWebhookAck(res: HttpResponse<WebhookAckResponse>, transferId: string, status: string): void {
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ transferId, status });
}

/** Erro do webhook: problem+json com `title` e `status` (a rota não envia `detail`). */
export function expectWebhookProblem(res: HttpResponse<unknown>, status: 400 | 401, title: string): void {
    expect(res.status, res.text).toBe(status);
    expect(res.headers["content-type"] ?? "").toContain("application/problem+json");
    expect(res.body).toMatchObject({ title, status });
}

/** 404 sem corpo. */
export function expectWebhookNotFound(res: HttpResponse<unknown>): void {
    expect(res.status, res.text).toBe(404);
    expect(res.text).toBe("");
}
