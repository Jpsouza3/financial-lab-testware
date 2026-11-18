import { HttpResponse } from "../core/http/HttpResponse";
import { GetTransferResponse } from "../domains/transfer/GetTransferResponse";
import { PostTransferBody } from "../domains/transfer/PostTransferBody";
import { PostTransferResponse } from "../domains/transfer/PostTransferResponse";
import { WebhookAckResponse } from "../domains/transfer/WebhookAckResponse";

export interface TransferInterface {
    PostTransfer(postTransferBody: PostTransferBody): Promise<HttpResponse<PostTransferResponse>>
    GetTransfer(transferId: string): Promise<HttpResponse<GetTransferResponse>>
    PostAntifraudWebhook(rawBody: string, headers: Record<string, string>): Promise<HttpResponse<WebhookAckResponse>>
}
