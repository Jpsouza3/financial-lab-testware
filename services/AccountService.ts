import { HttpResponse } from "../core/http/HttpResponse";
import { HttpClient } from "../core/http/HttpClient";
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
import { AccountInterface } from "../interfaces/AccountInterface";

export class AccountService implements AccountInterface {
    constructor(private httpClient: HttpClient) {}

    PostAccount(postAccountBody: PostAccountBody): Promise<HttpResponse<PostAccountResponse>> {
        return this.httpClient.post<PostAccountResponse>("/accounts", { json: postAccountBody });
    }

    GetAccount(accountId: string): Promise<HttpResponse<GetAccountResponse>> {
        return this.httpClient.get<GetAccountResponse>(`/accounts/${encodeURIComponent(accountId)}`);
    }

    PatchAccountStatus(accountId: string, body: PatchAccountStatusBody): Promise<HttpResponse<PatchAccountStatusResponse>> {
        return this.httpClient.patch<PatchAccountStatusResponse>(`/accounts/${encodeURIComponent(accountId)}/status`, { json: body });
    }

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

    DeleteHold(accountId: string, holdId: string): Promise<HttpResponse<DeleteHoldResponse>> {
        return this.httpClient.delete<DeleteHoldResponse>(
            `/accounts/${encodeURIComponent(accountId)}/holds/${encodeURIComponent(holdId)}`
        );
    }

    GetStatement(accountId: string, query: GetStatementQuery = {}): Promise<HttpResponse<GetStatementResponse>> {
        return this.httpClient.get<GetStatementResponse>(
            `/accounts/${encodeURIComponent(accountId)}/statement`,
            { params: { ...query } }
        );
    }
}
