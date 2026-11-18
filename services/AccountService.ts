import { HttpResponse } from "../core/http/HttpResponse";
import { HttpClient } from "../core/http/HttpClient";
import { GetBalanceResponse } from "../domains/account/GetBalanceResponse";
import { GetHoldResponse } from "../domains/account/GetHoldResponse";
import { GetHoldsResponse } from "../domains/account/GetHoldsResponse";
import { HoldStatus } from "../domains/account/HoldStatus";
import { PostHoldBody } from "../domains/account/PostHoldBody";
import { PostHoldResponse } from "../domains/account/PostHoldResponse";
import { AccountInterface } from "../interfaces/AccountInterface";

export class AccountService implements AccountInterface {
    constructor(private httpClient: HttpClient) {}

    GetBalance(accountId: string): Promise<HttpResponse<GetBalanceResponse>> {
        return this.httpClient.get<GetBalanceResponse>(`/accounts/${encodeURIComponent(accountId)}/balance`);
    }

    PostHold(accountId: string, postHoldBody: PostHoldBody): Promise<HttpResponse<PostHoldResponse>> {
        return this.httpClient.post<PostHoldResponse>(`/accounts/${encodeURIComponent(accountId)}/holds`, { json: postHoldBody });
    }

    GetHold(accountId: string, holdId: string): Promise<HttpResponse<GetHoldResponse>> {
        return this.httpClient.get<GetHoldResponse>(
            `/accounts/${encodeURIComponent(accountId)}/holds/${encodeURIComponent(holdId)}`
        );
    }

    GetHolds(accountId: string, status?: HoldStatus): Promise<HttpResponse<GetHoldsResponse>> {
        return this.httpClient.get<GetHoldsResponse>(
            `/accounts/${encodeURIComponent(accountId)}/holds`,
            { params: { status } }
        );
    }
}
