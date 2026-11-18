import { TransferStatus } from "./TransferStatus";

export type GetTransfersQuery = {
    simulationId?: string,
    status?: TransferStatus,
    take?: number
}
