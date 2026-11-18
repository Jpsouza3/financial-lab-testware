import { HttpResponse } from "../core/http/HttpResponse";
import { AnalysisResponse } from "../domains/antifraud/AnalysisResponse";
import { DeleteAnalysesResponse } from "../domains/antifraud/DeleteAnalysesResponse";
import { FraudRule } from "../domains/antifraud/FraudRule";
import { PostAnalysisBody } from "../domains/antifraud/PostAnalysisBody";
import { RuleBody } from "../domains/antifraud/RuleBody";

export interface AntifraudInterface {
    GetRules(): Promise<HttpResponse<FraudRule[]>>
    GetRule(id: string): Promise<HttpResponse<FraudRule>>
    PostRule(body: RuleBody): Promise<HttpResponse<FraudRule>>
    PutRule(id: string, body: RuleBody): Promise<HttpResponse<FraudRule>>
    PutRules(body: RuleBody[]): Promise<HttpResponse<FraudRule[]>>
    DeleteRule(id: string): Promise<HttpResponse<void>>
    ResetRules(): Promise<HttpResponse<FraudRule[]>>
    PostAnalysis(body: PostAnalysisBody): Promise<HttpResponse<AnalysisResponse>>
    GetAnalysis(analysisId: string): Promise<HttpResponse<AnalysisResponse>>
    GetAnalyses(query?: { transactionId?: string, take?: number }): Promise<HttpResponse<AnalysisResponse[]>>
    DeleteAnalyses(): Promise<HttpResponse<DeleteAnalysesResponse>>
}
