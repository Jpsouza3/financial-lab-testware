import { TransferStatus } from "./TransferStatus";

export type GetSimulationResponse = {
    simulationId: string,
    total: number,
    finished: boolean,
    byStatus: Partial<Record<TransferStatus, number>>
}
