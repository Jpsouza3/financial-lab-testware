export type PostAnalysisBody = {
    transactionId: string,
    amount: number,
    sourceAccountId: string,
    destinationAccountId: string,
    description?: string | null,
    callbackUrl: string
}
