type FormValue = string | number | boolean;

export type RequestBody =
    | {
        json: unknown;
      }
    | {
        form: Record<string, FormValue>;
      }
    | {
        multipart: FormData;
      }
    | {
        text: string;
      };