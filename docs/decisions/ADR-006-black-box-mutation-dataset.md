# ADR-006 - Synthetic commits run against the black-box suite

## Context

The predictive selector will see real commits (several files, varied size, mostly harmless). Single-line mutants alone teach that "every change breaks something". The suite is black-box HTTP, so Stryker.NET (which only sees .NET tests) cannot label it.

## Decision

- `mutation/catalog.json` holds concrete, reproducible changes (find/replace or new file) per catalog item: breaking (B-*), neutral (N-*), additive (D-*) and configuration (K-*). `npm run mutation:validate -- --compile` checks that each item applies once and compiles.
- `mutation/generate.ts` samples a recipe (`mutation/recipes.json`, with file and service weights) and composes items into a synthetic commit on a disposable worktree of the SUT at `mutation/base.json` (`base_sha`). Same seed, same patch (`--verify <id>`).
- `mutation/run.ts` applies the patch to a disposable worktree, rebuilds only the affected images, starts an isolated compose project per slot (parametrized ports), runs the frozen suite `suite-T0` and re-runs each failure twice (a failure only counts if it fails every time; tests that oscillate are marked `flaky`). It is resumable: ids with results are skipped.
- Synthetic commits are independent and applied over a fixed base; generation order (`seq`) is the time axis.

## Consequences

- Patches never touch the SUT `main`; worktrees are removed after each run.
- The suite must not change while generating (`suite-T0`); strengthening it means a new tag `T1` and re-labelling.
- Labels for time-sensitive items (workers, timeouts) can be probabilistic; they are recorded as executed, not as hypothesized.
