import { TransferResponse } from "../../../domains/transfer/TransferResponse";
import { AccountInterface } from "../../../interfaces/AccountInterface";
import { AntifraudInterface } from "../../../interfaces/AntifraudInterface";
import { TransferInterface } from "../../../interfaces/TransferInterface";
import { openAccountId } from "../account/accounts";
import { RuleScope } from "../e2e/rules";
import { createTransfer } from "../e2e/transfers";

/** Atraso máximo aceito pela regra: a análise fica Pending por 120 s. */
export const HOLD_SCREENING_DELAY_MS = 120_000;

export type ScreeningTransfer = {
    transfer: TransferResponse,
    sourceAccountId: string,
    destinationAccountId: string,
};

/**
 * Transferência parada em `Screening`: regra própria com `delivery` `Drop` e `delayMs` 120000, então o
 * antifraude não decide nem entrega nada e só o webhook do teste muda a transferência (a reconciliação
 * só a recusaria por timeout depois de 60 s).
 */
export async function openScreeningTransfer(
    services: { accountService: AccountInterface, transferService: TransferInterface, antifraudService: AntifraudInterface },
    rules: RuleScope,
    { amount = 10, initialDeposit = 100 }: { amount?: number, initialDeposit?: number } = {}
): Promise<ScreeningTransfer> {
    const { accountService, transferService, antifraudService } = services;
    const sourceAccountId = await openAccountId(accountService, { initialDeposit });
    const destinationAccountId = await openAccountId(accountService);
    await rules.create(antifraudService, sourceAccountId, {
        decision: "Approved",
        delayMs: HOLD_SCREENING_DELAY_MS,
        delivery: "Drop",
    });
    const transfer = await createTransfer(transferService, sourceAccountId, destinationAccountId, amount);
    return { transfer, sourceAccountId, destinationAccountId };
}
