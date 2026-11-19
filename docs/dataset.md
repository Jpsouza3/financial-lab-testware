# Dataset de seleção preditiva de testes

Uma linha por par (mudança no SUT × teste da suíte `suite-T0`), com o resultado do teste depois da mudança. Serve para treinar e avaliar um seletor que, dados os arquivos alterados, escolhe quais testes rodar.

## Como reproduzir

Pré-requisitos: Docker, Node 22, o SUT clonado em `../financial-lab-account` (ou `SUT_PATH`) com a base de `mutation/base.json` disponível.

```sh
npm ci
npm run mutation:validate -- --compile        # cada item do catálogo aplica e compila na base
npm run mutation:generate -- --count 20 --seed <s>   # repetir por lote (seção 2 do plano)
npm run mutation:run -- --slots 2 --workers 4  # retomável: pula ids com resultado
npm run mutation:run -- --baseline 20         # base sem mudança, delayMs 300/800/1500
npm run mutation:run -- --real <sha1>,<sha2>  # histórico real do SUT
npm run dataset                               # data/*.csv
npm run dataset:report                        # critérios de qualidade
npm run replay                                # seletor baseline vs rodar tudo
```

`npm run dataset` só lê `mutation/results/`, então reproduz o dataset a partir dos resultados versionados com um comando.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `data/dataset.csv` | Uma linha por mudança × teste (dicionário abaixo) |
| `data/changes.csv` | Uma linha por mudança, com contagem de falhas e flaky |
| `data/flakiness.csv` | Por teste, nas execuções da base sem mudança: execuções, falhas confirmadas, execuções com oscilação e taxa |
| `data/dataset-report.json` | Critérios do Apêndice B, lacunas (testes que nunca falham, itens que sobreviveram) e distribuições |
| `mutation/commits/<id>.patch`, `<id>.meta.json` | Patch, receita, itens do catálogo, seed e arquivos de cada commit sintético |
| `mutation/results/<id>.json` | Resultado por teste de cada execução (`baseline/` e `real/` em subpastas) |

## Dicionário (`data/dataset.csv`)

| Coluna | Descrição | Feature? |
|---|---|---|
| `change_id` | `syn-NNNN` (sintético) ou SHA (real) | id |
| `commit_kind` | `breaking`, `neutral`, `additive`, `config`, `mixed` ou `real` | **não** (deriva do catálogo) |
| `seq` | Ordem temporal: geração para sintéticos; reais vêm antes, por data, com `seq` negativo | eixo do split |
| `changed_files` | Arquivos alterados, separados por `;` (sem `bin/obj/.idea`) | sim |
| `changed_services` | `account`, `transfer`, `antifraud` tocados | sim |
| `files_changed_count`, `lines_changed` | Tamanho da mudança (linhas adicionadas + removidas) | sim |
| `test_id` | `<arquivo> › <describe> › <título>`, estável enquanto a suíte for T0 | id |
| `spec_id`, `service_tag` | Spec do SUT (`@spec:<slug>`) e serviço (`@account`, ...) do teste | sim |
| `result` | `passed`, `failed` ou `skipped`, depois de reexecutar cada falha 2x | **rótulo** |
| `flaky` | Falhou e depois passou em alguma reexecução nesta mudança | sim (com cuidado) |
| `duration_ms` | Soma da duração das execuções do teste | custo |
| `base_flaky_rate` | Fração das execuções da base em que o teste oscilou | sim |
| `catalog_ids`, `seed` | Itens aplicados e semente do sorteio | **não**: só auditoria |

Regras de rótulo: um teste só é `failed` se falha na execução e nas 2 reexecuções; se oscila, fica `passed` com `flaky = true`.

## Como foi gerado

1. **Suíte T0** (tag `suite-T0`): 245 testes de API caixa-preta, estáveis (0 falhas em 3 execuções seguidas), cada um criando os próprios dados (ADR-004).
2. **Catálogo** (`mutation/catalog.json`): itens concretos (localizar/substituir ou arquivo novo) dos tipos quebradora, neutra, aditiva e configuração, validados por aplicação única e compilação (ADR-006).
3. **Receitas** (`mutation/recipes.json`): `neutral-refactor`, `single-break`, `multi-break`, `cross-service`, `feature`, `config-change`, com pesos por arquivo ("quentes": `TransferService`, `Account`, `Transfer`).
4. **Execução**: cada commit é aplicado de forma independente sobre a base fixa, numa worktree descartável; só as imagens afetadas são reconstruídas; a pilha sobe isolada (porta e projeto por slot) e é destruída com `down -v` no fim.
5. **Loop**: lotes de 20, `dataset:report` depois de cada lote, ajuste de pesos/receitas até os critérios passarem ou o orçamento acabar.

## Split e vazamento

- Treino/teste **temporal por `seq`** (`scripts/replay.ts --train 0.7`), nunca embaralhado.
- `catalog_ids`, `seed`, `recipe` e `commit_kind` descrevem como a mudança foi fabricada; usá-los como feature vaza o rótulo.
- O histórico de falhas recentes usado pelo seletor só olha para mudanças com `seq` menor.

## Limitações

- **Mudanças sintéticas e independentes**: cada commit parte da mesma base; não há acúmulo, conflitos entre commits nem a correlação temporal de um repositório real.
- **Catálogo escrito à mão**: a distribuição de arquivos e tipos de mudança reflete os pesos escolhidos, não um histórico real. Itens neutros são refatorações seguras; mudanças reais misturam intenção e acidente de outra forma.
- **Volume pequeno** (centenas de mudanças, ~245 testes) e um único SUT.
- **Flakiness induzida ≠ real**: a variação de `delayMs` e a carga de duas pilhas em paralelo produzem oscilações de tempo; flakiness de rede, banco ou ordem de testes de um CI real não aparece.
- **Itens sensíveis a tempo** (workers, timeouts, reconciliação) podem matar testes de forma probabilística; o rótulo é o executado, não o esperado.
- **Histórico real curto**: o SUT tem poucos commits que compilam com Dockerfile; os reais são minoria no dataset.
- **Itens não observáveis por HTTP** (concorrência e redelivery de mensagens: B-TXN-*, B-ACC-11/12) geram mutantes equivalentes para esta suíte.
