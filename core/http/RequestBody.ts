export type FormValue = string | number | boolean;

/** Corpo da requisição. O adapter decide como cada variante vira wire format. */
export type RequestBody =
    | { json: unknown }
    | { form: Record<string, FormValue> }
    | { multipart: FormData }
    | { text: string; contentType?: string };
