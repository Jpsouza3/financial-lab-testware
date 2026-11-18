export type PostSimulationBody = {
    transfers: number,
    minAmount: number,
    maxAmount: number,
    accountIds?: string[] | null
}
