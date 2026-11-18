export type PostTransferBody = {
    sourceAccountId: string,
    destinationAccountId: string,
    amount: number,
    description?: string | null
}
