export interface RequestOptions {
    headers?: Record<string, string>;
    params?: Record<string, string>;
      basicAuth?: {
    username: string;
    password: string;
  };
}