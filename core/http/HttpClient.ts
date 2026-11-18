import { HttpResponse } from "./HttpResponse";
import { RequestBody } from "./RequestBody";
import { RequestOptions } from "./RequestOptions";

/**
 * Porta HTTP do testware (ADR-001). Services dependem só dela.
 *
 * Não lança erro por status: 4xx/5xx voltam como `HttpResponse` para o teste afirmar.
 */
export interface HttpClient {
    get<T>(url: string, options?: RequestOptions): Promise<HttpResponse<T>>;
    post<T>(url: string, body?: RequestBody, options?: RequestOptions): Promise<HttpResponse<T>>;
    put<T>(url: string, body?: RequestBody, options?: RequestOptions): Promise<HttpResponse<T>>;
    patch<T>(url: string, body?: RequestBody, options?: RequestOptions): Promise<HttpResponse<T>>;
    delete<T>(url: string, options?: RequestOptions & { body?: RequestBody }): Promise<HttpResponse<T>>;
}
