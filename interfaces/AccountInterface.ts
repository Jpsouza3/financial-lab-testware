import { HttpResponse } from "../core/http/HttpResponse";
import { DeleteHoldResponse } from "../domains/account/DeleteHoldResponse";
import { GetAccountResponse } from "../domains/account/GetAccountResponse";
import { GetBalanceResponse } from "../domains/account/GetBalanceResponse";
import { GetHoldResponse } from "../domains/account/GetHoldResponse";
import { GetHoldsResponse } from "../domains/account/GetHoldsResponse";
import { GetStatementQuery } from "../domains/account/GetStatementQuery";
import { GetStatementResponse } from "../domains/account/GetStatementResponse";
import { HoldStatus } from "../domains/account/HoldStatus";
import { PatchAccountStatusBody } from "../domains/account/PatchAccountStatusBody";
import { PatchAccountStatusResponse } from "../domains/account/PatchAccountStatusResponse";
import { PostAccountBody } from "../domains/account/PostAccountBody";
import { PostAccountResponse } from "../domains/account/PostAccountResponse";
import { PostHoldBody } from "../domains/account/PostHoldBody";
import { PostHoldResponse } from "../domains/account/PostHoldResponse";

export interface AccountInterface {
    PostAccount(postAccountBody: PostAccountBody): Promise<HttpResponse<PostAccountResponse>>
    GetAccount(accountId: string): Promise<HttpResponse<GetAccountResponse>>
    PatchAccountStatus(accountId: string, body: PatchAccountStatusBody): Promise<HttpResponse<PatchAccountStatusResponse>>
    GetBalance(accountId: string): Promise<HttpResponse<GetBalanceResponse>>
    PostHold(accountId: string, postHoldBody: PostHoldBody): Promise<HttpResponse<PostHoldResponse>>
    GetHold(accountId: string, holdId: string): Promise<HttpResponse<GetHoldResponse>>
    GetHolds(accountId: string, status?: HoldStatus): Promise<HttpResponse<GetHoldsResponse>>
    DeleteHold(accountId: string, holdId: string): Promise<HttpResponse<DeleteHoldResponse>>
    GetStatement(accountId: string, query?: GetStatementQuery): Promise<HttpResponse<GetStatementResponse>>
}
