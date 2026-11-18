import { TransferLeg } from "./TransferLeg";
import { TransferStatus } from "./TransferStatus";

export type TransferResponse = {
    id: string,
    sourceAccountId: string,
    destinationAccountId: string,
    amount: number,
    description: string | null,
    endToEndId: string,
    refundEndToEndId: string | null,
    status: TransferStatus,
    failureReason: string | null,
    simulationId: string | null,
    createdAt: string,
    updatedAt: string,
    debit: TransferLeg | null,
    credit: TransferLeg | null,
    refund: TransferLeg | null
}
