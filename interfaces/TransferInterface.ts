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

export interface TransferInterface {
    PostTransfer(postTransferBody: PostTransferBody): Promise<HttpResponse<PostTransferResponse>>
    PostTransferRaw(rawBody: string): Promise<HttpResponse<PostTransferResponse>>
    GetTransfer(transferId: string): Promise<HttpResponse<GetTransferResponse>>
    GetTransfers(query?: GetTransfersQuery): Promise<HttpResponse<GetTransfersResponse>>
    PostSimulation(postSimulationBody: PostSimulationBody): Promise<HttpResponse<PostSimulationResponse>>
    GetSimulation(simulationId: string): Promise<HttpResponse<GetSimulationResponse>>
    PostAntifraudWebhook(rawBody: string, headers: Record<string, string>): Promise<HttpResponse<WebhookAckResponse>>
}
