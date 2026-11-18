import { HttpResponse } from "../../../core/http/HttpResponse";
import { ContractValidator } from "../../../core/schema/ContractValidator";
import { GetBalanceResponse } from "../../../domains/account/GetBalanceResponse";
import { FraudRule } from "../../../domains/antifraud/FraudRule";
import { RuleBody } from "../../../domains/antifraud/RuleBody";
import { PostTransferBody } from "../../../domains/transfer/PostTransferBody";
import { TransferResponse } from "../../../domains/transfer/TransferResponse";
import { TransferResponseSchema } from "../../../domains/transfer/TransferResponseSchema";
import { TransferStatus } from "../../../domains/transfer/TransferStatus";
import { expect } from "../../../fixtures/ApiFixtures";
import { AntifraudInterface } from "../../../interfaces/AntifraudInterface";
import { TransferInterface } from "../../../interfaces/TransferInterface";
import { cents } from "../account/holds";

export const TRANSFER_DETAIL = {
    sameAccount: "A conta de origem e a de destino devem ser diferentes.",
    amount: "O valor deve ser maior que zero.",
    decimals: "O valor deve ter no máximo 2 casas decimais.",
    description: "A descrição deve ter no máximo 140 caracteres.",
    sourceRequired: "A conta de origem é obrigatória.",
    destinationRequired: "A conta de destino é obrigatória.",
} as const;

export const FAILURE_REASON = {
    highValue: "Valor acima do limite de risco.",
    ruleDefault: (ruleId: string) => `Recusada pela regra ${ruleId}.`,
    screeningTimeout: "O antifraude não respondeu a tempo.",
    closed: "Conta Closed: movimentação não permitida.",
    blocked: "Conta Blocked: débito não permitido.",
    insufficient: "Saldo insuficiente.",
    notFound: (accountId: string) => `Conta ${accountId} não encontrada.`,
} as const;

export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

/** `E`/`D` + ISPB `99999999` + `yyyyMMddHHmm` UTC + 11 alfanuméricos (32 caracteres). */
export function endToEndIdPattern(prefix: "E" | "D"): RegExp {
    return new RegExp(`^${prefix}99999999\\d{12}[A-Za-z0-9]{11}$`);
}

/** Data/hora `yyyyMMddHHmm` contida no endToEndId, como instante UTC. */
export function endToEndIdInstant(endToEndId: string): number {
    const s = endToEndId.slice(9, 21);
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
}

export function buildTransferBody(
    sourceAccountId: string,
    destinationAccountId: string,
    overrides: Partial<PostTransferBody> = {}
): PostTransferBody {
    return { sourceAccountId, destinationAccountId, amount: 1.0, description: "Transferência de teste", ...overrides };
}

/** Corpo propositalmente inválido (campo ausente) para os casos de validação. */
export function invalidTransferBody(body: Record<string, unknown>): PostTransferBody {
    return body as unknown as PostTransferBody;
}

/** 202 + Location + contrato + campos enviados, status Screening, sem pernas. */
export function expectTransferAccepted(res: HttpResponse<TransferResponse>, body: PostTransferBody): TransferResponse {
    expect(res.status, res.text).toBe(202);
    ContractValidator.validate(TransferResponseSchema, res.body);
    const transfer = res.body;
    expect(res.headers["location"]).toMatch(new RegExp(`/transfers/${transfer.id}$`, "i"));
    expect(transfer).toMatchObject({
        sourceAccountId: body.sourceAccountId,
        destinationAccountId: body.destinationAccountId,
        amount: body.amount,
        description: body.description ?? null,
        refundEndToEndId: null,
        status: "Screening",
        failureReason: null,
        simulationId: null,
        debit: null,
        credit: null,
        refund: null,
    });
    expect(transfer.endToEndId).toMatch(endToEndIdPattern("E"));
    expect(transfer.createdAt).toMatch(/Z$/);
    return transfer;
}

/** Cria a transferência e afirma o 202. */
export async function createTransfer(transferService: TransferInterface, body: PostTransferBody): Promise<TransferResponse> {
    return expectTransferAccepted(await transferService.PostTransfer(body), body);
}

export async function getTransfer(transferService: TransferInterface, transferId: string): Promise<TransferResponse> {
    const res = await transferService.GetTransfer(transferId);
    expect(res.status, `GET /transfers/${transferId}: ${res.text}`).toBe(200);
    ContractValidator.validate(TransferResponseSchema, res.body);
    return res.body;
}

/** Consulta a transferência até o status pedido (status final diferente falha logo). */
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
                return last.status;
            },
            { message: `transferência ${transferId} deveria chegar a ${status}`, timeout, intervals: [250, 500, 1_000] }
        )
        .toBe(status);
    return last!;
}

/** Cria e espera o status final. */
export async function transferAndWait(
    transferService: TransferInterface,
    body: PostTransferBody,
    status: TransferStatus,
    timeout?: number
): Promise<TransferResponse> {
    const created = await createTransfer(transferService, body);
    return waitForTransferStatus(transferService, created.id, status, timeout);
}

/** Completed: débito na origem e crédito no destino com o mesmo endToEndId, sem estorno. */
export function expectCompletedLegs(transfer: TransferResponse): void {
    expect(transfer.status).toBe("Completed");
    expect(transfer.failureReason).toBeNull();
    expect(transfer.refundEndToEndId).toBeNull();
    expect(transfer.refund).toBeNull();
    expect(transfer.debit, "perna de débito").not.toBeNull();
    expect(transfer.credit, "perna de crédito").not.toBeNull();
    expect(transfer.debit!.accountId).toBe(transfer.sourceAccountId);
    expect(transfer.credit!.accountId).toBe(transfer.destinationAccountId);
    expect(transfer.debit!.endToEndId).toBe(transfer.endToEndId);
    expect(transfer.credit!.endToEndId).toBe(transfer.endToEndId);
    expect(transfer.debit!.entryId).not.toBe(transfer.credit!.entryId);
    expect(Date.parse(transfer.credit!.occurredAt)).toBeGreaterThanOrEqual(Date.parse(transfer.debit!.occurredAt));
    expect(Date.parse(transfer.updatedAt)).toBeGreaterThan(Date.parse(transfer.createdAt));
}

/** Status final sem movimentação: sem pernas, sem estorno e com o motivo esperado. */
export function expectNoLegs(transfer: TransferResponse, status: TransferStatus, failureReason: string): void {
    expect(transfer).toMatchObject({ status, failureReason, refundEndToEndId: null, debit: null, credit: null, refund: null });
}

/** Saldo após movimento de `delta` (positivo = crédito), version + `versions`. */
export function expectBalanceMoved(before: GetBalanceResponse, after: GetBalanceResponse, delta: number, versions = 1): void {
    expect(after.balance).toBeCloseTo(cents(before.balance + delta), 2);
    expect(after.availableBalance).toBeCloseTo(cents(before.availableBalance + delta), 2);
    expect(after.blockedBalance).toBeCloseTo(before.blockedBalance, 2);
    expect(after.version).toBe(before.version + versions);
}

/** id de regra único (até 64 caracteres). */
export function uniqueRuleId(prefix = "trf"): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Executa `run` com uma regra própria do antifraude e a remove ao fim.
 * A regra precisa ser escopada por contas do teste e ficar abaixo de 1000,00 (ARCHITECTURE.md).
 */
export async function withRule<T>(
    antifraudService: AntifraudInterface,
    rule: RuleBody & { sourceAccountIds: string[] },
    run: (rule: FraudRule) => Promise<T>
): Promise<T> {
    const body: RuleBody = { id: uniqueRuleId(), enabled: true, maxAmount: 999.99, ...rule };
    const res = await antifraudService.PostRule(body);
    expect(res.status, `POST /rules: ${res.text}`).toBe(201);
    try {
        return await run(res.body);
    } finally {
        await antifraudService.DeleteRule(body.id!);
    }
}
