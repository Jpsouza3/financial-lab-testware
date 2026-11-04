  import {
    APIRequestContext,
    APIResponse
  } from "@playwright/test";

  import { RequestBody } from "./RequestBody";
  import { HttpClient } from "./HttpClient";
  import { RequestOptions } from "./RequestOptions";
  import { HttpResponse } from "./HttpResponse";

  export class PlaywrightHttpClient implements HttpClient {
    private token?: string;

    constructor(private request: APIRequestContext) {}

        private async handleResponse<T>(
        response: APIResponse
      ): Promise<HttpResponse<T>> {

        let body: T;

        try {
          body = await response.json();
        } catch {
          body = await response.text() as unknown as T;
        }

        return {
          body,
          raw: response,
        };
    }

    private buildRequestBody(body?: RequestBody) {
      if (!body) {
        return {};
      }

      if ("json" in body) {
        return {
          data: body.json,
        };
      }

      if ("form" in body) {
        return {
          form: body.form,
        };
      }

      return {};
    }

    public setToken(token: string): void {
      this.token = token;
    }

    private buildHeaders(
      options?: RequestOptions
    ): Record<string, string> {
      const headers = {
        ...options?.headers,
        ...(this.token && {
          Authorization: `Bearer ${this.token}`,
        }),
      };
      
      if (options?.basicAuth) {
      const credentials = Buffer
      .from(
        `${options.basicAuth.username}:${options.basicAuth.password}`
      )
      .toString("base64");

      headers.Authorization = `Basic ${credentials}`;
    }

    return headers;
      
    }

    async get<T>(
      url: string,
      body?: RequestBody,
      options?: RequestOptions
    ): Promise<HttpResponse<T>> {
      const response = await this.request.get(url, {
        ...this.buildRequestBody(body),
        headers: this.buildHeaders(options), 
        params: options?.params,
      });

      return this.handleResponse<T>(response);
    }

    async post<T>(
      url: string,
      body?: RequestBody,
      options?: RequestOptions
    ): Promise<HttpResponse<T>> {
      const response = await this.request.post(url, {
        ...this.buildRequestBody(body),
        headers: this.buildHeaders(options), 
        params: options?.params,
      });

      return this.handleResponse<T>(response);
    }

    async put<T>(
      url: string,
      body?: RequestBody,
      options?: RequestOptions
    ): Promise<HttpResponse<T>> {
      const response = await this.request.put(url, {
        ...this.buildRequestBody(body),
        headers: this.buildHeaders(options), 
        params: options?.params,
      });

      return this.handleResponse<T>(response);
    }

    async delete<T>(
      url: string,
      body?: RequestBody,
      options?: RequestOptions
    ): Promise<HttpResponse<T>> {
      const response = await this.request.delete(url, {
        ...this.buildRequestBody(body),
        headers: this.buildHeaders(options), 
        params: options?.params,
      });

      return this.handleResponse<T>(response);
    }


  }


  