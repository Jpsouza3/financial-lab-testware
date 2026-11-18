import { TransferStatus } from "./TransferStatus";

export type WebhookAckResponse = {
    transferId: string,
    status: TransferStatus
}
