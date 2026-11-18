import { HttpClient } from "../core/http/HttpClient";
import { HttpResponse } from "../core/http/HttpResponse";
import { GetSimulationResponse } from "../domains/transfer/GetSimulationResponse";
import { GetTransferResponse } from "../domains/transfer/GetTransferResponse";
import { GetTransfersQuery } from "../domains/transfer/GetTransfersQuery";
import { GetTransfersResponse } from "../domains/transfer/GetTransfersResponse";
import { PostSimulationBody } from "../domains/transfer/PostSimulationBody";
import { PostSimulationResponse } from "../domains/transfer/PostSimulationResponse";
import { PostTransferBody } from "../domains/transfer/PostTransferBody";
import { PostTransferResponse } from "../domains/transfer/PostTransferResponse";
import { WebhookAckResponse } from "../domains/transfer/WebhookAckResponse";
import { TransferInterface } from "../interfaces/TransferInterface";

export class TransferService implements TransferInterface {
    constructor(private httpClient: HttpClient) {}

    PostTransfer(postTransferBody: PostTransferBody): Promise<HttpResponse<PostTransferResponse>> {
        return this.httpClient.post<PostTransferResponse>("/transfers", { json: postTransferBody });
    }

    PostTransferRaw(rawBody: string): Promise<HttpResponse<PostTransferResponse>> {
        return this.httpClient.post<PostTransferResponse>("/transfers", { text: rawBody, contentType: "application/json" });
    }

    GetTransfer(transferId: string): Promise<HttpResponse<GetTransferResponse>> {
        return this.httpClient.get<GetTransferResponse>(`/transfers/${encodeURIComponent(transferId)}`);
    }

    GetTransfers(query: GetTransfersQuery = {}): Promise<HttpResponse<GetTransfersResponse>> {
        return this.httpClient.get<GetTransfersResponse>("/transfers", { params: query });
    }

    PostSimulation(postSimulationBody: PostSimulationBody): Promise<HttpResponse<PostSimulationResponse>> {
        return this.httpClient.post<PostSimulationResponse>("/simulations", { json: postSimulationBody });
    }

    GetSimulation(simulationId: string): Promise<HttpResponse<GetSimulationResponse>> {
        return this.httpClient.get<GetSimulationResponse>(`/simulations/${encodeURIComponent(simulationId)}`);
    }

    PostAntifraudWebhook(rawBody: string, headers: Record<string, string>): Promise<HttpResponse<WebhookAckResponse>> {
        return this.httpClient.post<WebhookAckResponse>("/webhooks/antifraud", { text: rawBody, contentType: "application/json" }, { headers });
    }
}
