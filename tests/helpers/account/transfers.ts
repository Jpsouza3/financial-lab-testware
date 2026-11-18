import { TransferResponse } from "../../../domains/transfer/TransferResponse";
import { TransferStatus } from "../../../domains/transfer/TransferStatus";
import { expect } from "../../../fixtures/ApiFixtures";
import { TransferInterface } from "../../../interfaces/TransferInterface";

const FINAL_STATUSES: readonly TransferStatus[] = ["Completed", "Failed", "Refunded", "RefundFailed"];

/** Consulta a transferência até um status final (Completed, Failed, Refunded ou RefundFailed). */
export async function waitForTransferSettled(
    transferService: TransferInterface,
    transferId: string,
    timeout = 30_000
): Promise<TransferResponse> {
    let last: TransferResponse | undefined;
    await expect
        .poll(
            async () => {
                last = (await transferService.GetTransfer(transferId)).body;
                return FINAL_STATUSES.includes(last.status);
            },
            { message: `transferência ${transferId} deveria chegar a um status final`, timeout, intervals: [250, 500, 1_000] }
        )
        .toBe(true);
    return last!;
}

/** Cria a transferência (< 1000,00, abaixo da regra padrão do antifraude) e espera o status final. */
export async function transferAndSettle(
    transferService: TransferInterface,
    sourceAccountId: string,
    destinationAccountId: string,
    amount: number
): Promise<TransferResponse> {
    expect(amount, "transferências de teste ficam abaixo de 1000,00").toBeLessThan(1000);
    const res = await transferService.PostTransfer({ sourceAccountId, destinationAccountId, amount });
    expect(res.ok, `POST /transfers: ${res.text}`).toBe(true);
    return waitForTransferSettled(transferService, res.body.id);
}
