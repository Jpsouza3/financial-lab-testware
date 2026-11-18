import { HttpResponse } from "../core/http/HttpResponse";
import { GetTransferResponse } from "../domains/transfer/GetTransferResponse";
import { PostTransferBody } from "../domains/transfer/PostTransferBody";
import { PostTransferResponse } from "../domains/transfer/PostTransferResponse";

export interface TransferInterface {
    PostTransfer(postTransferBody: PostTransferBody): Promise<HttpResponse<PostTransferResponse>>
    GetTransfer(transferId: string): Promise<HttpResponse<GetTransferResponse>>
}
