/**
 * Erro no formato RFC 9457 (`application/problem+json`).
 * Campos de extensão (`traceId`, `errors`...) podem vir na resposta; o schema os aceita.
 */
export type ProblemDetails = {
    type?: string,
    title?: string,
    status?: number,
    detail: string,
    instance?: string
}
