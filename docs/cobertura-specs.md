# Cobertura das specs

Gerado por `npx tsx scripts/spec-coverage.ts` em 2026-11-18. Total: **245 testes** (8 no projeto `global`).

| Spec (SUT `specs/`) | Testes | Arquivos | Serviço |
|---|---|---|---|
| `abrir-conta` | 27 | `account/get-account.spec.ts`, `account/post-account.spec.ts` | @account |
| `alterar-status-conta` | 23 | `account/patch-account-status.spec.ts` | @account |
| `analises-antifraude` | 34 | `antifraud/analysis-decision.spec.ts`, `antifraud/analysis-webhook.spec.ts`, `antifraud/get-analysis.spec.ts`, `antifraud/post-analysis.spec.ts`, `e2e/antifraud-delivery-modes.spec.ts`, `antifraud/analyses-global.spec.ts` | @antifraud, @e2e |
| `criar-bloqueio-saldo` | 24 | `account/post-hold.spec.ts` | @account |
| `criar-transferencia` | 36 | `e2e/transfer-final-statuses.spec.ts`, `transfer/get-transfer.spec.ts`, `transfer/get-transfers.spec.ts`, `transfer/post-transfer.spec.ts` | @e2e, @transfer |
| `extrato-conta` | 23 | `account/get-statement.spec.ts` | @account |
| `liberar-bloqueio-saldo` | 15 | `account/delete-hold.spec.ts` | @account |
| `reconciliacao-antifraude` | 7 | `transfer/reconciliation.spec.ts` | @transfer |
| `regras-antifraude` | 26 | `antifraud/delete-rule.spec.ts`, `antifraud/get-rules.spec.ts`, `antifraud/post-rule.spec.ts`, `antifraud/put-rule.spec.ts`, `antifraud/rules-global.spec.ts` | @antifraud |
| `simulacao-transferencias` | 13 | `transfer/get-simulation.spec.ts`, `transfer/post-simulation.spec.ts` | @transfer |
| `webhook-antifraude` | 17 | `e2e/antifraud-delivery-modes.spec.ts`, `transfer/post-antifraud-webhook.spec.ts` | @e2e, @transfer |

| Serviço | Testes |
|---|---|
| `@account` | 112 |
| `@transfer` | 65 |
| `@antifraud` | 58 |
| `@e2e` | 10 |
