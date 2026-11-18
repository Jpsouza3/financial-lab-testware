import { ContractValidator } from "../../../core/schema/ContractValidator";
import { AnalysisResponse } from "../../../domains/antifraud/AnalysisResponse";
import { AnalysisResponseSchema } from "../../../domains/antifraud/AnalysisResponseSchema";
import { PostTransferBody } from "../../../domains/transfer/PostTransferBody";
import { TransferResponse } from "../../../domains/transfer/TransferResponse";
import { TransferResponseSchema } from "../../../domains/transfer/TransferResponseSchema";
import { TransferStatus } from "../../../domains/transfer/TransferStatus";
import { expect } from "../../../fixtures/ApiFixtures";
import { AntifraudInterface } from "../../../interfaces/AntifraudInterface";
import { TransferInterface } from "../../../interfaces/TransferInterface";

/** Status finais da transferência (spec "Criar Transferência"). */
export const FINAL_STATUSES: readonly TransferStatus[] = ["FraudRejected", "Completed", "Failed", "Refunded", "RefundFailed"];

export const REASON = {
    rejectedByAntifraud: "Recusada pelo antifraude.",
    screeningTimeout: "O antifraude não respondeu a tempo.",
    closed: "Conta Closed: movimentação não permitida.",
    blocked: "Conta Blocked: débito não permitido.",
    insufficient: "Saldo insuficiente.",
} as const;

export async function createTransfer(
    transferService: TransferInterface,
    sourceAccountId: string,
    destinationAccountId: string,
    amount = 10,
    description: string | null = "Teste e2e antifraude"
): Promise<TransferResponse> {
    const body: PostTransferBody = { sourceAccountId, destinationAccountId, amount, description };
    const res = await transferService.PostTransfer(body);
    expect(res.status, `POST /transfers: ${res.text}`).toBe(202);
    ContractValidator.validate(TransferResponseSchema, res.body);
    expect(res.body.status).toBe("Screening");
    return res.body;
}

export async function getTransfer(transferService: TransferInterface, transferId: string): Promise<TransferResponse> {
    const res = await transferService.GetTransfer(transferId);
    expect(res.status, `GET /transfers/${transferId}: ${res.text}`).toBe(200);
    ContractValidator.validate(TransferResponseSchema, res.body);
    return res.body;
}

/**
 * Consulta até a transferência chegar a `status` ou a outro status final (aí falha logo, sem esperar o timeout).
 */
export async function waitForTransferStatus(
    transferService: TransferInterface,
    transferId: string,
    status: TransferStatus,
    timeout = 30_000
): Promise<TransferResponse> {
    let last: TransferResponse | undefined;
    await expect
        .poll(
            async () => {
                last = await getTransfer(transferService, transferId);
                return last.status === status || FINAL_STATUSES.includes(last.status) ? last.status : "esperando";
            },
            { message: `transferência ${transferId} deveria chegar a ${status}`, timeout, intervals: [500, 1_000] }
        )
        .toBe(status);
    return last!;
}

/** Janela fixa só para provar que algo NÃO aconteceu (mensageria entre as APIs leva menos de 1 s). */
export const NO_EFFECT_WINDOW_MS = 3_000;

export function waitNoEffectWindow(ms = NO_EFFECT_WINDOW_MS): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Segundos entre dois instantes ISO 8601. */
export function secondsBetween(fromIso: string, toIso: string): number {
    return (Date.parse(toIso) - Date.parse(fromIso)) / 1000;
}

/** A análise do antifraude para o `endToEndId` (ou `undefined` se ainda não existe). */
export async function findAnalysis(antifraudService: AntifraudInterface, transactionId: string): Promise<AnalysisResponse | undefined> {
    const res = await antifraudService.GetAnalyses({ transactionId });
    expect(res.status, `GET /analyses?transactionId=${transactionId}: ${res.text}`).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(1);
    if (res.body.length === 0) return undefined;
    ContractValidator.validate(AnalysisResponseSchema, res.body[0]);
    return res.body[0];
}

/** Consulta a análise até o webhook terminar (`webhook.status` diferente de `Pending`). */
export async function waitForWebhookDone(
    antifraudService: AntifraudInterface,
    transactionId: string,
    timeout = 15_000
): Promise<AnalysisResponse> {
    let last: AnalysisResponse | undefined;
    await expect
        .poll(
            async () => {
                last = await findAnalysis(antifraudService, transactionId);
                return last?.webhook.status ?? "sem análise";
            },
            { message: `webhook da análise ${transactionId} deveria terminar`, timeout, intervals: [300, 500, 1_000] }
        )
        .toMatch(/^(Delivered|Failed|Skipped)$/);
    return last!;
}

/** Nada mudou na transferência (status, motivo, pernas, version implícita em `updatedAt`). */
export function expectTransferUnchanged(before: TransferResponse, after: TransferResponse): void {
    expect(after).toEqual(before);
}
