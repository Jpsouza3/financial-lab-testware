# Relatório do orquestrador: seleção preditiva de testes

Estado em 2026-11-18 (fim do lote 2). Plano de origem: `PLANO-selecao-preditiva-final.md` + `PLANO-commits-sinteticos.md` (fora do repositório).

## Checkpoint: onde parou e como retomar

**Parou em:** lote 2 concluído (40 commits sintéticos executados, `syn-0001`..`syn-0040`). Próximo passo: lote 3.

**Repositórios e branches (todas enviadas ao GitHub):**

| Repo | Branch | Conteúdo |
|---|---|---|
| SUT `Jpsouza3/financial-lab` (`/mnt/ssd1/projects/financial-lab-account`) | `chore/fase-1-higiene` | Fase 1 |
| | `feat/fase-4-compose-param` | Fase 1 + correções do SUT + compose parametrizado. **É a base do dataset** (`mutation/base.json`, SHA `bf20772`) |
| Testware `Jpsouza3/financial-lab-testware` (`/mnt/ssd1/projects/financial-lab-testware`) | `feat/fase-2-suite` → `feat/fase-4-mutation` → `feat/fase-5-dataset` → `feat/fase-6-ci` → `feat/fase-7-selector` | Empilhadas, uma por fase. **Trabalho continua em `feat/fase-7-selector`** (topo, contém tudo, inclusive os resultados dos lotes) |
| | tag `suite-T0` | Suíte congelada (245 testes). Não alterar `tests/` enquanto gera o dataset |

Nada foi mergeado em `main` (nem no SUT nem no testware): os PRs ficam com o dono.

**Para retomar (na raiz do testware, branch `feat/fase-7-selector`):**

```sh
cd /mnt/ssd1/projects/financial-lab-account && docker compose stop   # libera CPU; a pilha dev não é usada pelo loop
cd /mnt/ssd1/projects/financial-lab-testware
npm run -s dataset && npm run -s dataset:report      # estado atual dos critérios
# ajustar mutation/recipes.json conforme o relatório (ver "Loop" abaixo), depois:
npx tsx mutation/generate.ts --count 20 --seed 3000  # lote 3 (seed do lote N = N*1000)
npx tsx mutation/run.ts --slots 2 --workers 4 > mutation/logs/batch3.log 2>&1
npm run -s dataset && npm run -s dataset:report
git add mutation/commits mutation/results mutation/recipes.json data && git commit -m "data: lote 3 ..."
git push git@github.com:Jpsouza3/financial-lab-testware.git feat/fase-7-selector   # o remote https não tem credencial
```

- `run.ts` é retomável: se cair no meio, rodar de novo pula os ids com `mutation/results/<id>.json`. Um commit sem resultado (interrompido) é reexecutado.
- Ritmo medido: ~2,6 min por commit com 2 slots × 4 workers nesta máquina (8 CPUs, 15 GB).
- Pilhas órfãs depois de uma queda: `docker compose ls | grep flmut` e `docker compose -p flmut-0 down -v` (idem `flmut-1`); worktrees: `git -C ../financial-lab-account worktree prune`. Arquivos de build criados pelo container (root): `docker run --rm -v $PWD/mutation/.work:/w alpine rm -rf /w/<dir>`.

**Pendente, em ordem:**

1. Lotes 3 a ~7 até ≥ 120 commits válidos (critério 1), ajustando pesos entre lotes.
2. `npx tsx mutation/run.ts --baseline 20 --slots 2` (critério 7: flakiness da base, `delayMs` 300/800/1500). ~50 min.
3. Histórico real: `npx tsx mutation/run.ts --real c75b22e,e9f0b4f,de258d8,99ec817,32261b1,bf20772 --slots 2` (cada um reconstrói todas as imagens). O commit `985384b` não tem Dockerfile: fora.
4. `npm run dataset`, `npm run dataset:report`, `npm run replay` e preencher as seções de números deste relatório.
5. Opcional (Fase 3, cortada até agora): testes xUnit + Stryker.NET em `*.Business/Services/**`.

## Loop: lotes e ajustes

| Lote | Commits | Seed | Ajuste aplicado antes do lote | Resultado |
|---|---|---|---|---|
| 1 | syn-0001..0020 | 1000 | pesos iniciais do plano | 55% com falha; account em 85%; 10/68 itens B sorteados, todos mataram |
| 2 | syn-0021..0040 | 2000 | `neutral-refactor` 30→36, `single-break` 25→22, `multi-break` 10→9, `cross-service` 10→8; `serviceWeights.account` 0,8, transfer/antifraud 1,1; itens B já usados com peso 0,3 | 45% com falha (dentro do alvo); account 77,5%; 18/68 itens B sorteados, 17 mataram (B-ACC-11 é equivalente: a Transfer API valida antes) |

Regra de ajuste usada (seção 2 do plano): fração com falha acima de 50% → mais `neutral-refactor`; serviço acima/abaixo → `serviceWeights`; itens B nunca sorteados → `itemWeights` 0,3 nos já usados; testes que nunca falham → ver `data/dataset-report.json` (`gaps.never_failed_tests`): ou falta item no catálogo que os alcance (propor `B-XXX-NN` novo, validar com `npm run mutation:validate -- --compile --ids ...`), ou o teste é fraco (reforçar só numa suíte `T1`, refazendo os rótulos).

## O que foi feito por fase

### Fase 1: higiene do SUT
`.gitignore` .NET e remoção de `bin/`, `obj/`, `.idea/` do índice (623 → 147 arquivos versionados). `docker compose build` ok.

### Fase 2: suíte de API (`suite-T0`)
- **245 testes**, 11 specs, **0 falhas em 3 execuções seguidas** (1 `fixme` pré-existente: HLD-10). Distribuição em `docs/cobertura-specs.md` (`npx tsx scripts/spec-coverage.ts`): account 112, transfer 65, antifraud 58, e2e 10; 8 no projeto `global`.
- Gerada por 4 subagentes (account, transfer, antifraud, webhook/e2e) aplicando `translation.md` e `planning.md` do spec-to-test sem checkpoints humanos; casos e planos em `.test-generation/<slug>/` (fora do git).
- Mudanças de convenção (ARCHITECTURE.md, ADR-004): testes criam as próprias contas (`openAccount`); estado global do antifraude isolado (regras escopadas; testes `@global` num projeto de 1 worker); tags `@<serviço>` e `@spec:<slug>`; cliente da Antifraud API.
- Todos os cenários assíncronos obrigatórios cobertos: Duplicate, Drop → reconciliação, timeout fail-closed → FraudRejected, InvalidSignature → 401, Flip, `submitFailures` com retry, crédito recusado → Refunded.

**Bugs do SUT encontrados pela suíte e corrigidos** (branch `feat/fase-4-compose-param`):

| Commit | Problema |
|---|---|
| `de258d8` | Resposta de criação com timestamp em 100 ns; leitura devolvia o valor do Postgres (µs) |
| `32261b1` | ~20 aberturas de conta concorrentes na mesma agência davam 500 (5 tentativas sem espera) |
| `bf20772` | Transferência sem origem/destino ficava 60 s em Screening (antifraude recusa conta vazia); agora 400 na criação. Spec `criar-transferencia` 1.1.0 (R5, R6) |
| `99ec817` | Compose parametrizado por porta/imagem e sem `container_name` (pilhas paralelas) |

### Fase 3 (opcional)
Cortada até agora por tempo, conforme a ordem de corte do plano.

### Fase 4: commits sintéticos
- `mutation/catalog.json`: 114 itens concretos (68 B, 30 N, 9 D, 7 K): todos do Apêndice A + `B-HLD-07`, `B-OPN-01..03`, `B-STS-01..02`, `B-SIM-01..02`; neutros/aditivas/config em variantes por arquivo. 114/114 aplicam uma vez e compilam (`npm run mutation:validate -- --compile`).
- `generate.ts` (reprodutível: `--verify <id>`), `run.ts` (worktree descartável, rebuild só das imagens afetadas, compose `flmut-<slot>` com portas próprias, reexecução 2x das falhas, retomável), ADR-006.
- Aceite "20 commits ponta a ponta + reprodutibilidade": atingido no lote 1.

### Fase 5: dataset
`npm run dataset` → `data/dataset.csv` (mudança × teste), `data/changes.csv`, `data/flakiness.csv`; `npm run dataset:report` → critérios do Apêndice B em `data/dataset-report.json`. Dicionário e limitações em `docs/dataset.md`. CSV em vez de Parquet (sem dependência nativa).

### Fase 6: CI
- `.github/workflows/api-tests.yml`: em qualquer push/PR e manual; sobe o SUT (ref em `.sut-ref`, hoje `feat/fase-4-compose-param`; trocar para `main` depois do merge do SUT), roda `npm run check` e a suíte com `scripts/ci-run.ts` (mesmo formato de resultado do dataset), publica artefato (90 dias) e histórico em cache (ADR-005). **Primeira execução verde** (run 44419311956, branch `feat/fase-7-selector`). Badge no README.
- `.github/workflows/mutation.yml`: lote de mutação só por `workflow_dispatch`.

### Fase 7: seletor
- `scripts/select-tests.ts`: arquivos alterados (stdin ou `--files`) → `ids`, `files`, `grep` ou `json`. Baseline determinístico: tags dos serviços tocados (`selector/service-map.json`) + falhas recentes (`--history`); infraestrutura (Dockerfile, compose, Contracts, migrações) → suíte completa; só docs → nada.
- No CI: com `sut_base` informado e fora da `main`, roda o seletor; falha do seletor ou `main` → suíte completa.
- `scripts/replay.ts`: split temporal por `seq` (70/30), recall médio, recall por teste, fração de mudanças com recall 100% e tempo economizado, contra "rodar tudo".

## Números

Depois de 2 lotes (40 commits sintéticos, todos válidos; 9.800 linhas mudança × teste):

| # | Critério (Apêndice B) | Valor | Alvo | Status |
|---|---|---|---|---|
| 1 | Commits válidos | 40 | ≥ 120 | falta (lotes 3+) |
| 2 | Commits com ≥ 1 falha | 45,0% | 30–50% | ok |
| 3 | Serviços / cross-service | account 77,5%, transfer 45,0%, antifraud 55,0%; cross 57,5% | ≥ 25% cada; cross ≥ 10% | ok |
| 4 | Testes que falham em ≥ 1 commit | 63,1% (154/244) | ≥ 70% | falta |
| 5 | Itens B que mataram ≥ 1 teste | 94,4% (17/18; 50 nunca sorteados) | ≥ 70% | ok |
| 6 | Cauda pesada | 5 commits com ≥ 10 falhas; 26,7% dos quebradores com 1–2 | ≥ 5 e ≥ 30% | falta (perto) |
| 7 | Flakiness da base | 0 execuções | ≥ 20 | falta (pendência 2) |
| 8 | Sem vazamento | split por `seq`; `catalog_ids` só auditoria | — | ok |
| 9 | Dataset discrimina | recall médio do baseline 82,1% (10/18 commits com 100%) | < 100% | ok |

Flakiness observada nas reexecuções dos lotes: 4 testes oscilaram uma vez em 40 commits (marcados `flaky`, não contam como falha).

Replay (split temporal 28 treino / 12 teste, `seq` 29..40):

| Seletor | Recall médio | Recall por teste | Tempo economizado | Testes rodados |
|---|---|---|---|---|
| Rodar tudo | 100% | 100% | 0% | 100% |
| Serviço → testes | 72,9% | 76,3% | 53,1% | 55,2% |
| Serviço → testes + falhas recentes | 78,5% | 84,9% | 47,2% | 56,4% |

O baseline perde falhas cruzadas (ex.: mudança no antifraude quebrando testes de transfer; campo novo em resposta de saldo quebrando testes de todos os serviços): é o espaço que o modelo precisa ocupar.

**Sugestão para o lote 3:** subir `single-break` (critério 6: mais commits com 1–2 falhas), manter `itemWeights` 0,3 nos itens B já usados (agora 18) para alcançar os 90 testes que nunca falharam, e baixar mais `serviceWeights.account` (0,6) porque os neutros de account ainda puxam a fração para 77,5%.

## ADRs

ADR-001 a 003 (já existiam), ADR-004 (dados pela API e estado global), ADR-005 (persistência no CI: artefato + cache), ADR-006 (commits sintéticos contra a suíte caixa-preta).

## O que falta para plugar o modelo

- Completar o dataset (pendências 1 a 4 do checkpoint).
- Treinar com features de `data/dataset.csv` (arquivos, serviços, tamanho, `spec_id`, `service_tag`, `base_flaky_rate`, histórico de falhas por teste), nunca `catalog_ids`/`seed`/`commit_kind`, e split por `seq`.
- Implementar o modelo como outra função com a mesma assinatura de `selectTests` (`selector/select.ts`) e comparar no `scripts/replay.ts` contra os dois baselines já reportados.
- No CI, trocar a chamada do baseline pelo modelo mantendo o fallback para a suíte completa.
