# ADR-003 - Environment configuration

## Context

`EnvironmentConfig.ts` required a `.env.<ENV>` file to exist, even in CI where variables come from the environment, stopped at the first missing variable and did not validate values.

## Decision

- `core/config/EnvironmentConfig.ts` is the only reader of `process.env` (enforced by `npm run lint:arch`).
- Precedence: variables already in the process, then `.env.<ENV>` (default `local`) if the file exists.
- Typed readers (`core/config/EnvReader.ts`): `required`, `optional`, `url` (http/https, trailing slash removed), `list`. Problems are collected and reported together.
- `config` is frozen. Every key is documented in the versioned `.env.example`.
- Test data (account IDs) is optional: the test that needs it calls `test.skip` with the reason.

## Consequences

- CI runs with exported variables and no file.
- A new required key still breaks every environment without it; prefer optional keys for test data.
