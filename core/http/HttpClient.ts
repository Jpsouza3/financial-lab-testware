import { HttpResponse } from "./HttpResponse";
import { RequestOptions } from "./RequestOptions";
import { RequestBody } from "./RequestBody";

export interface HttpClient {
    get<T>(
        url: string,
        body?: RequestBody,
        options?: RequestOptions
    ) : Promise<HttpResponse<T>>;

    post<T>(
        url: string,
        body?: RequestBody,
        options?: RequestOptions
    ) : Promise<HttpResponse<T>>;

    put<T>(
        url: string,
        body?: RequestBody,
        options?: RequestOptions
    ) : Promise<HttpResponse<T>>;

    delete<T>(
        url: string,
        body?: RequestBody,
        options?: RequestOptions
    ) : Promise<HttpResponse<T>>;
}