import { AnalysisStatus } from "./AnalysisStatus";
import { AnalysisWebhook } from "./AnalysisWebhook";

export type AnalysisResponse = {
    id: string,
    transactionId: string,
    status: AnalysisStatus,
    reason: string | null,
    ruleId: string | null,
    amount: number,
    sourceAccountId: string,
    destinationAccountId: string,
    description: string | null,
    createdAt: string,
    decidedAt: string | null,
    webhook: AnalysisWebhook
}
