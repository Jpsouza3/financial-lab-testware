# ADR-002 - Typed contract schemas with AJV

## Context

Responses are validated with AJV. Schemas were declared as `JSONSchemaType<T>` or as untyped `SchemaObject`. `JSONSchemaType<T>` rejects a required `X | null` field with `nullable: true`, so most schemas fell back to `SchemaObject`, and nothing kept the schema, the TypeScript type and the enum lists in sync. The validator also recompiled the schema on every call and reported errors as raw JSON.

## Decision

- `defineSchema<T>()` (`core/schema/Schema.ts`) declares an object schema bound to `T`: `properties` must have exactly the keys of `T`, and `required` must contain every non-optional key. Helpers `arrayOf` and `nullable` compose schemas.
- The schema carries `T` (`Schema<T>`), so `ContractValidator.validate(schema, body)` narrows `body` without repeating the generic.
- Enums are `as const` arrays shared by the type and the schema (`HOLD_STATUSES`).
- `ContractValidator` uses one AJV instance (`allErrors`, `strict`, `ajv-formats`), caches compiled schemas, and throws `ContractError` with one line per violation plus the received payload.
- Error responses are validated against `ProblemDetailsSchema` (RFC 9457).

## Consequences

### Positive

- Adding or renaming a field in a type without updating its schema is a compile error.
- Readable failures in the Playwright report.

### Negative

- `defineSchema` checks keys, not the JSON type of each property (e.g. `type: "string"` for a `number` field still compiles); review keeps that.
