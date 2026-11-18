import { HttpResponse } from "../core/http/HttpResponse";
import { GetBalanceResponse } from "../domains/account/GetBalanceResponse";
import { GetHoldResponse } from "../domains/account/GetHoldResponse";
import { GetHoldsResponse } from "../domains/account/GetHoldsResponse";
import { HoldStatus } from "../domains/account/HoldStatus";
import { PostHoldBody } from "../domains/account/PostHoldBody";
import { PostHoldResponse } from "../domains/account/PostHoldResponse";

export interface AccountInterface {
    GetBalance(accountId: string): Promise<HttpResponse<GetBalanceResponse>>
    PostHold(accountId: string, postHoldBody: PostHoldBody): Promise<HttpResponse<PostHoldResponse>>
    GetHold(accountId: string, holdId: string): Promise<HttpResponse<GetHoldResponse>>
    GetHolds(accountId: string, status?: HoldStatus): Promise<HttpResponse<GetHoldsResponse>>
}
