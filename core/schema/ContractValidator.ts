import Ajv, { ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { Schema } from "./Schema";

/**
 * Validação de contrato com AJV.
 *
 * - Uma instância de AJV para todo o testware (`allErrors`, formatos de `ajv-formats`).
 * - Cada schema é compilado uma vez e reaproveitado (cache por referência do objeto).
 * - O schema carrega o tipo (`Schema<T>`, criado com `defineSchema<T>()`), então
 *   `validate(HoldResponseSchema, body)` estreita `body` para `HoldResponse` sem repetir o genérico.
 */
export class ContractValidator {
    private static readonly ajv = addFormats(new Ajv({ allErrors: true, strict: true }));
    private static readonly cache = new WeakMap<object, ValidateFunction>();

    /** Lança `ContractError` se `data` não segue o schema; caso contrário, estreita `data` para `T`. */
    static validate<T>(schema: Schema<T>, data: unknown): asserts data is T {
        const validate = this.compile(schema);
        if (!validate(data)) throw new ContractError(validate.errors ?? [], data);
    }

    /** Lista de violações (vazia quando válido). Para casos em que o teste quer inspecionar o erro. */
    static errors(schema: Schema<unknown>, data: unknown): string[] {
        const validate = this.compile(schema);
        return validate(data) ? [] : formatErrors(validate.errors ?? []);
    }

    private static compile(schema: Schema<unknown>): ValidateFunction {
        let validate = this.cache.get(schema);
        if (!validate) {
            validate = this.ajv.compile(schema);
            this.cache.set(schema, validate);
        }
        return validate;
    }
}

export class ContractError extends Error {
    constructor(readonly violations: ErrorObject[], readonly data: unknown) {
        const lines = formatErrors(violations).map((v) => `  - ${v}`).join("\n");
        const received = JSON.stringify(data, null, 2) ?? String(data);
        super(`Contract validation failed:\n${lines}\nReceived:\n${truncate(received, 2_000)}`);
        this.name = "ContractError";
    }
}

function formatErrors(errors: ErrorObject[]): string[] {
    return errors.map((e) => {
        const where = e.instancePath || "(root)";
        const extra =
            e.keyword === "additionalProperties" ? ` "${(e.params as { additionalProperty: string }).additionalProperty}"`
            : e.keyword === "enum" ? ` ${JSON.stringify((e.params as { allowedValues: unknown[] }).allowedValues)}`
            : "";
        return `${where} ${e.message ?? e.keyword}${extra}`;
    });
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}… (+${text.length - max} chars)` : text;
}
