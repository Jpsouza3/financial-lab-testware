import { DeliveryAttempt } from "./DeliveryAttempt";
import { DeliveryMode } from "./DeliveryMode";
import { WebhookStatus } from "./WebhookStatus";

export type AnalysisWebhook = {
    mode: DeliveryMode,
    status: WebhookStatus,
    attempts: DeliveryAttempt[]
}
