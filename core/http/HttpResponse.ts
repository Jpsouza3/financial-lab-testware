/**
 * Resposta HTTP independente de biblioteca.
 *
 * Nenhum tipo do Playwright aparece aqui: interfaces, services e testes leem
 * status, headers e body sem saber qual cliente fez a chamada (ADR-001).
 */
export interface HttpResponse<T> {
    /** Status HTTP (ex.: 201). */
    status: number;
    /** `true` para status 2xx. */
    ok: boolean;
    /** Headers com nomes em minúsculas (ex.: `content-type`, `location`). */
    headers: Record<string, string>;
    /**
     * Corpo já interpretado: JSON quando o corpo é JSON válido, texto caso contrário,
     * `undefined` quando vazio (ex.: 204). O tipo `T` é uma promessa do chamador:
     * valide com `ContractValidator.validate` antes de confiar nele.
     */
    body: T;
    /** Corpo bruto em texto, útil em mensagens de erro de asserção. */
    text: string;
}
