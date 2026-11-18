import type { APIRequestContext, APIResponse } from "@playwright/test";
import { HttpClient } from "./HttpClient";
import { HttpResponse } from "./HttpResponse";
import { RequestBody } from "./RequestBody";
import { RequestAuth, RequestOptions } from "./RequestOptions";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type FetchOptions = NonNullable<Parameters<APIRequestContext["fetch"]>[1]>;

/**
 * Adapter: implementa a porta `HttpClient` sobre o `APIRequestContext` do Playwright.
 * É o único arquivo fora de `fixtures/` e `tests/` que importa `@playwright/test`
 * (verificado por `npm run lint:arch`).
 */
export class PlaywrightHttpClient implements HttpClient {
    private token?: string;

    constructor(private readonly request: APIRequestContext) {}

    /** Token Bearer padrão de todas as chamadas seguintes. */
    setToken(token: string): void {
        this.token = token;
    }

    clearToken(): void {
        this.token = undefined;
    }

    get<T>(url: string, options?: RequestOptions): Promise<HttpResponse<T>> {
        return this.send<T>("GET", url, undefined, options);
    }

    post<T>(url: string, body?: RequestBody, options?: RequestOptions): Promise<HttpResponse<T>> {
        return this.send<T>("POST", url, body, options);
    }

    put<T>(url: string, body?: RequestBody, options?: RequestOptions): Promise<HttpResponse<T>> {
        return this.send<T>("PUT", url, body, options);
    }

    patch<T>(url: string, body?: RequestBody, options?: RequestOptions): Promise<HttpResponse<T>> {
        return this.send<T>("PATCH", url, body, options);
    }

    delete<T>(url: string, options?: RequestOptions & { body?: RequestBody }): Promise<HttpResponse<T>> {
        return this.send<T>("DELETE", url, options?.body, options);
    }

    private async send<T>(
        method: Method,
        url: string,
        body: RequestBody | undefined,
        options: RequestOptions | undefined
    ): Promise<HttpResponse<T>> {
        const response = await this.request.fetch(url, {
            method,
            ...this.toPlaywrightBody(body),
            headers: this.buildHeaders(body, options),
            params: this.buildParams(options?.params),
            timeout: options?.timeout,
            failOnStatusCode: false,
        });
        return this.toHttpResponse<T>(response);
    }

    private toPlaywrightBody(body?: RequestBody): Pick<FetchOptions, "data" | "form" | "multipart"> {
        if (!body) return {};
        if ("json" in body) return { data: body.json };
        if ("form" in body) return { form: body.form };
        if ("multipart" in body) return { multipart: body.multipart };
        return { data: body.text };
    }

    private buildHeaders(body?: RequestBody, options?: RequestOptions): Record<string, string> {
        const headers: Record<string, string> = { ...options?.headers };
        if (body && "json" in body) headers["Content-Type"] ??= "application/json";
        if (body && "text" in body) headers["Content-Type"] ??= body.contentType ?? "text/plain";

        const authorization = this.authorization(options?.auth);
        if (authorization) headers.Authorization = authorization;
        return headers;
    }

    private authorization(auth?: RequestAuth): string | undefined {
        if (!auth) return this.token && `Bearer ${this.token}`;
        if ("none" in auth) return undefined;
        if ("bearer" in auth) return `Bearer ${auth.bearer}`;
        const { username, password } = auth.basic;
        return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    }

    private buildParams(params?: RequestOptions["params"]): Record<string, string | number | boolean> | undefined {
        if (!params) return undefined;
        const defined = Object.entries(params).filter(
            (entry): entry is [string, string | number | boolean] => entry[1] !== undefined
        );
        return Object.fromEntries(defined);
    }

    private async toHttpResponse<T>(response: APIResponse): Promise<HttpResponse<T>> {
        const text = await response.text();
        return {
            status: response.status(),
            ok: response.ok(),
            headers: response.headers(),
            body: parseBody(text) as T,
            text,
        };
    }
}

function parseBody(text: string): unknown {
    if (text === "") return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
