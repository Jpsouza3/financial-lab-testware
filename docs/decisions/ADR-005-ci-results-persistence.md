# ADR-005 - Persisting structured CI results

## Context

Phase 6 of the predictive test selection plan requires every CI run to leave a queryable, structured result, and the selector needs the recent failures as history.

## Options

1. Commit results to a `data` branch: durable and diffable, but every run needs write permission on the repository and creates noisy commits.
2. Workflow artifacts plus an `actions/cache` history: no writes to git, retention of 90 days, history restored by key prefix.

## Decision

Option 2.

- `scripts/ci-run.ts` writes `ci-history/<run>.json` in the same format as `mutation/results/<id>.json` (per test: `test_id`, `spec_id`, `service_tag`, `result`, `flaky`, `duration_ms`, runs).
- The file is uploaded as the `api-test-results-<run>` artifact (90 days) and the `ci-history/` folder is saved to the cache `ci-history-<run_id>`; the next run restores the latest one (`restore-keys: ci-history-`) and passes it to `select-tests --history`.
- The synthetic commit loop runs locally or through `workflow_dispatch` (`mutation.yml`), never on push.

## Consequences

- No repository write permission needed; results are consultable through the run page and `gh run download`.
- The cache can be evicted (7 days without use, 10 GB limit): the selector then has no recent failures and falls back to the service map only. Long-term analysis must download the artifacts.
