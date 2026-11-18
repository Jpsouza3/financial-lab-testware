import { HttpClient } from "../core/http/HttpClient";
import { HttpResponse } from "../core/http/HttpResponse";
import { AnalysisResponse } from "../domains/antifraud/AnalysisResponse";
import { DeleteAnalysesResponse } from "../domains/antifraud/DeleteAnalysesResponse";
import { FraudRule } from "../domains/antifraud/FraudRule";
import { PostAnalysisBody } from "../domains/antifraud/PostAnalysisBody";
import { RuleBody } from "../domains/antifraud/RuleBody";
import { AntifraudInterface } from "../interfaces/AntifraudInterface";

export class AntifraudService implements AntifraudInterface {
    constructor(private httpClient: HttpClient) {}

    GetRules(): Promise<HttpResponse<FraudRule[]>> {
        return this.httpClient.get<FraudRule[]>("/rules");
    }

    GetRule(id: string): Promise<HttpResponse<FraudRule>> {
        return this.httpClient.get<FraudRule>(`/rules/${encodeURIComponent(id)}`);
    }

    PostRule(body: RuleBody): Promise<HttpResponse<FraudRule>> {
        return this.httpClient.post<FraudRule>("/rules", { json: body });
    }

    PutRule(id: string, body: RuleBody): Promise<HttpResponse<FraudRule>> {
        return this.httpClient.put<FraudRule>(`/rules/${encodeURIComponent(id)}`, { json: body });
    }

    PutRules(body: RuleBody[]): Promise<HttpResponse<FraudRule[]>> {
        return this.httpClient.put<FraudRule[]>("/rules", { json: body });
    }

    DeleteRule(id: string): Promise<HttpResponse<void>> {
        return this.httpClient.delete<void>(`/rules/${encodeURIComponent(id)}`);
    }

    ResetRules(): Promise<HttpResponse<FraudRule[]>> {
        return this.httpClient.post<FraudRule[]>("/rules/reset");
    }

    PostAnalysis(body: PostAnalysisBody): Promise<HttpResponse<AnalysisResponse>> {
        return this.httpClient.post<AnalysisResponse>("/analyses", { json: body });
    }

    GetAnalysis(analysisId: string): Promise<HttpResponse<AnalysisResponse>> {
        return this.httpClient.get<AnalysisResponse>(`/analyses/${encodeURIComponent(analysisId)}`);
    }

    GetAnalyses(query: { transactionId?: string, take?: number } = {}): Promise<HttpResponse<AnalysisResponse[]>> {
        return this.httpClient.get<AnalysisResponse[]>("/analyses", { params: query });
    }

    DeleteAnalyses(): Promise<HttpResponse<DeleteAnalysesResponse>> {
        return this.httpClient.delete<DeleteAnalysesResponse>("/analyses");
    }
}
