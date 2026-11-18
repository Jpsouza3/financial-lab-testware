import { AnalysisStatus } from "./AnalysisStatus";

export type DeliveryAttempt = {
    deliveryId: string,
    attempt: number,
    decision: AnalysisStatus,
    statusCode: number | null,
    error: string | null,
    at: string
}
