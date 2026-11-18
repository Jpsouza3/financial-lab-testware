import { HttpClient } from "../core/http/HttpClient";
import { HttpResponse } from "../core/http/HttpResponse";
import { GetTransferResponse } from "../domains/transfer/GetTransferResponse";
import { PostTransferBody } from "../domains/transfer/PostTransferBody";
import { PostTransferResponse } from "../domains/transfer/PostTransferResponse";
import { WebhookAckResponse } from "../domains/transfer/WebhookAckResponse";
import { TransferInterface } from "../interfaces/TransferInterface";

export class TransferService implements TransferInterface {
    constructor(private httpClient: HttpClient) {}

    PostTransfer(postTransferBody: PostTransferBody): Promise<HttpResponse<PostTransferResponse>> {
        return this.httpClient.post<PostTransferResponse>("/transfers", { json: postTransferBody });
    }

    GetTransfer(transferId: string): Promise<HttpResponse<GetTransferResponse>> {
        return this.httpClient.get<GetTransferResponse>(`/transfers/${encodeURIComponent(transferId)}`);
    }

    PostAntifraudWebhook(rawBody: string, headers: Record<string, string>): Promise<HttpResponse<WebhookAckResponse>> {
        return this.httpClient.post<WebhookAckResponse>("/webhooks/antifraud", { text: rawBody, contentType: "application/json" }, { headers });
    }
}
