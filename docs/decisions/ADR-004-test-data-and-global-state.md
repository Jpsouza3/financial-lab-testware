# ADR-004 - Test data created through the API and isolated global state

## Context

The suite used pre-existing accounts configured by slot (`ACTIVE_ACCOUNT_IDS`), so each run needed "clean" accounts. The predictive test selection dataset runs the suite against a fresh `docker compose` stack per synthetic commit, in parallel, and labels must not depend on order or leftovers. The antifraud rules and analyses are global in-memory state shared by every test.

## Decision

- Every test opens its own accounts with `POST /accounts` (`tests/helpers/account/accounts.ts`: random valid CPF, `initialDeposit` up to 5000.00, `Blocked`/`Closed` through `PATCH /status`). `ACTIVE_ACCOUNT_IDS`, `BLOCKED_ACCOUNT_ID` and `CLOSED_ACCOUNT_ID` were removed.
- Parallel tests never change the global rule list: they add rules with a unique id scoped to their own accounts (`sourceAccountIds`) below the default `valor-alto` amount and delete them afterwards.
- Tests that must touch global state (`POST /rules/reset`, `PUT /rules`, default rules, `DELETE /analyses`, `GET /analyses?take`) are tagged `@global` and run in the `global` Playwright project (1 worker) after the `api` project (`npm test`). They end with `POST /rules/reset`.

## Consequences

- The suite runs against an empty database and in any order; no seed or manual preparation.
- Each run leaves accounts behind (cheap: the dataset stack is recreated with `down -v`).
- Two Playwright invocations are needed (`api`, then `global`); the runners (`npm test`, `mutation/run.ts`, `scripts/ci-run.ts`) do this.
