import { SchemaObject } from "ajv";

declare const contractType: unique symbol;

/** Schema AJV que carrega o tipo validado `T` (só em compile-time). */
export type Schema<T> = SchemaObject & { readonly [contractType]?: T };

/** Chaves obrigatórias de `T` (as que não são `?`). */
type RequiredKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T] & string;

type ObjectSchema<T, R extends readonly (keyof T & string)[]> = {
    type: "object";
    /** Uma entrada por campo de `T`: falta ou sobra de campo é erro de compilação. */
    properties: { [K in keyof T]-?: SchemaObject };
    required: R;
    additionalProperties: boolean;
    [keyword: string]: unknown;
};

type CheckRequired<T, R extends readonly string[]> =
    [Exclude<RequiredKeys<T>, R[number]>] extends [never]
        ? unknown
        : { "campos obrigatórios do tipo ausentes em required": Exclude<RequiredKeys<T>, R[number]> };

/**
 * Define o schema de um objeto amarrado ao tipo `T`:
 * - `properties` tem exatamente os campos de `T`;
 * - `required` só aceita campos de `T` e precisa conter todos os não opcionais.
 *
 * Substitui `JSONSchemaType<T>`, que não aceita campo obrigatório `X | null` com `nullable: true`.
 *
 * @example
 * export const HoldResponseSchema = defineSchema<HoldResponse>()({ type: "object", properties: {...}, required: [...], additionalProperties: false });
 */
export function defineSchema<T>() {
    return <const R extends readonly (keyof T & string)[]>(schema: ObjectSchema<T, R> & CheckRequired<T, R>): Schema<T> =>
        schema as unknown as Schema<T>;
}

/** Schema de lista cujos itens seguem `items`. */
export function arrayOf<T>(items: Schema<T>, keywords: SchemaObject = {}): Schema<T[]> {
    return { ...keywords, type: "array", items } as Schema<T[]>;
}

/** Torna um schema de objeto anulável (`X | null`). */
export function nullable<T>(schema: Schema<T>): Schema<T | null> {
    return { ...schema, nullable: true } as Schema<T | null>;
}
