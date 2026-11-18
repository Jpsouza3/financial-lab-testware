export interface BasicAuth {
    username: string;
    password: string;
}

/**
 * Autenticação por requisição. Sobrepõe o token padrão do cliente.
 * `{ none: true }` envia a chamada sem `Authorization` (casos 401).
 */
export type RequestAuth = { bearer: string } | { basic: BasicAuth } | { none: true };

export type QueryValue = string | number | boolean;

export interface RequestOptions {
    headers?: Record<string, string>;
    /** Query string. Valores `undefined` são omitidos. */
    params?: Record<string, QueryValue | undefined>;
    auth?: RequestAuth;
    /** Timeout da requisição em ms (padrão do cliente quando omitido). */
    timeout?: number;
}
