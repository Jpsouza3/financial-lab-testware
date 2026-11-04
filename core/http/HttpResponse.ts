import { APIResponse } from "@playwright/test";

export interface HttpResponse<T> {
  body: T;
  raw: APIResponse;
}