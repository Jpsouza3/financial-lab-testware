# ARCHITECTURE

Fonte única de convenções do financial-lab-testware. A fase 2 da skill `spec-to-test` planeja a partir deste arquivo, e quem implementa o plano segue este arquivo. Divergência entre código e documento: siga o documento e registre a divergência.

Testes de API com Playwright + TypeScript. Três APIs: **account** (contas, saldo, extrato e bloqueios), **transfer** (transferências, simulações, webhook do antifraude) e **antifraud** (regras e análises do antifraude simulado). Idioma de testes, helpers e docs: português (pt-BR); identificadores de código em inglês.

## Camadas

Dependências só no sentido da tabela (de baixo para cima). `npm run lint:arch` reprova qualquer import fora dela.

| Camada | Onde | Convenção | Pode importar | Exemplo |
|--------|------|-----------|---------------|---------|
| HTTP (porta) | `core/http/HttpClient.ts` | Interface `get/post/put/patch/delete` → `Promise<HttpResponse<T>>`. Sem tipos do Playwright. Não lança erro por status | `core/http` | `core/http/HttpClient.ts` |
| HTTP (adapter) | `core/http/PlaywrightHttpClient.ts` | Único arquivo de `core/` que importa `@playwright/test`. Converte `RequestBody`/`RequestOptions` para o `APIRequestContext` e a resposta para `HttpResponse` | `core/http`, `@playwright/test` | idem |
| Contrato | `core/schema/` | `defineSchema<T>()`, `arrayOf`, `nullable` (`Schema.ts`); `ContractValidator.validate(schema, body)` | `core/schema`, `ajv` | `core/schema/ContractValidator.ts` |
| Config | `core/config/EnvironmentConfig.ts` | Único leitor de `process.env`. `config.<chave>` congelado | `core/config`, `dotenv` | idem |
| Tipos | `domains/<domínio>/` | Um `type` por arquivo: `<Método><Recurso>Body`, `<Método><Recurso>Response`. Resposta compartilhada vira alias (`PostHoldResponse = HoldResponse`) | `domains`, `core/schema` | `domains/account/PostHoldBody.ts` |
| Enums | `domains/<domínio>/<Nome>Status.ts` | `const <NOMES> = [...] as const` + `type <Nome> = (typeof <NOMES>)[number]`. O schema usa a mesma constante em `enum` | idem | `domains/account/HoldStatus.ts` |
| Schemas | `domains/<domínio>/<Tipo>Schema.ts` | `defineSchema<Tipo>()({...})`, `additionalProperties: false`, `format: "uuid"`/`"date-time"`, `nullable: true` para `X \| null`. Lista: `arrayOf(ItemSchema)` | idem | `domains/account/HoldResponseSchema.ts` |
| Erros | `domains/common/ProblemDetails*.ts` | problem+json (RFC 9457) | idem | `domains/common/ProblemDetailsSchema.ts` |
| Interface | `interfaces/<Domínio>Interface.ts` | Métodos PascalCase `<Método><Recurso>(...)`: `Promise<HttpResponse<T>>`. É o tipo que fixtures e helpers expõem | `domains`, `core/http` | `interfaces/AccountInterface.ts` |
| Service | `services/<Domínio>Service.ts` | `implements <Domínio>Interface`, recebe `HttpClient` no construtor. Só monta rota, corpo e query; sem asserção, sem `expect`, sem lógica de teste | `interfaces`, `domains`, `core/http` | `services/AccountService.ts` |
| Fixtures | `fixtures/ApiFixtures.ts` | Composition root: `serviceFixture(config.<x>ApiUrl, (http) => new <X>Service(http))`, tipado pela **interface**. Exporta `test` e `expect` | `core/config`, `core/http`, `interfaces`, `services`, `@playwright/test` | idem |
| Helpers | `tests/helpers/<domínio>/`, `tests/helpers/common/` | Montagem de dados (`build*`), fluxos multi-chamada (`create*`, `waitFor*`) e asserções reutilizáveis (`expect*`). Recebem a interface (`AccountInterface`), não o service | `fixtures`, `core/*`, `domains`, `interfaces` | `tests/helpers/account/holds.ts` |
| Specs | `tests/<domínio>/<método>-<recurso>.spec.ts` | Só testes. `test`/`expect` de `fixtures/ApiFixtures` | idem a helpers | `tests/account/post-hold.spec.ts` |

## Base URL e rotas

- Uma variável de base URL por API (`ACCOUNT_API_URL`, `TRANSFER_API_URL`, `ANTIFRAUD_API_URL`), aplicada como `baseURL` pelo fixture. Sem barra final (o config remove).
- O service usa rota relativa começando com `/` (`/accounts/${encodeURIComponent(accountId)}/holds`). A base URL deve ser só a origem: com `/`, um caminho na base URL seria descartado.
- `encodeURIComponent` em todo parâmetro de rota. Query em `options.params` (valores `undefined` são omitidos, então `{ params: { status } }` com `status` opcional basta).
- API nova: chave `<x>ApiUrl` no config + `.env.example`, `interfaces/<X>Interface.ts`, `services/<X>Service.ts`, fixture `<x>Service` em `fixtures/ApiFixtures.ts`.

## Autenticação

As APIs atuais não exigem autenticação. Quando exigirem:
- token padrão do cliente: `PlaywrightHttpClient.setToken(token)` no fixture (obtido por um fixture de login de escopo `worker`);
- por chamada: `options.auth` = `{ bearer }`, `{ basic: { username, password } }` ou `{ none: true }` (casos 401). `auth` sobrepõe o token padrão.

## Respostas

- `HttpResponse<T>` = `{ status, ok, headers, body, text }` (`core/http/HttpResponse.ts`). Nada de `APIResponse`.
  - status: `res.status`; header: `res.headers["location"]` (nomes em minúsculas); corpo bruto para mensagens: `res.text`.
  - `body` é JSON quando o corpo é JSON, texto caso contrário, `undefined` quando vazio (204).
- `T` é uma promessa, não uma garantia: resposta de sucesso que o teste usa passa por `ContractValidator.validate(Schema, res.body)` (estreita o tipo; não repita o genérico).
- Erro: `application/problem+json` com `detail`. Afirme com `expectProblem(res, status, detail)` (`tests/helpers/common/problem.ts`), que também valida o contrato `ProblemDetailsSchema`.
- Mensagem de asserção de status: `expect(res.status, res.text).toBe(201)`.

## Contrato (AJV)

- Todo tipo de resposta tem schema irmão, e os dois mudam juntos. `defineSchema<T>()` não compila se `properties` tiver campo a mais ou a menos que `T`, ou se `required` não tiver todos os campos não opcionais.
- Enum: mesma constante no tipo e no schema (nunca repetir a lista literal).
- `additionalProperties: false` em respostas da API; `true` só em contratos abertos por norma (problem+json).
- Não usar `JSONSchemaType<T>` (não aceita campo obrigatório `X | null`) nem `SchemaObject` solto.

## Specs de teste

- Título: `<PREFIXO>-NN: <descrição>` (o ID liga o teste ao caso da spec; nunca renumerar IDs existentes). Título único no arquivo: `arquivo › describe › título` é o `test_id` estável do dataset de seleção de testes.
- Tags no `test.describe` de topo: serviço (`@account`, `@transfer`, `@antifraud` ou `@e2e`) e spec (`@spec:<slug do arquivo em specs/ do SUT>`, ex.: `@spec:criar-bloqueio-saldo`). Exemplo: `test.describe("POST /accounts/{accountId}/holds", { tag: ["@account", "@spec:criar-bloqueio-saldo"] }, () => {...})`.
- Cabeçalho de comentário com a feature, a versão da spec `(vX.Y.Z)`, a operação e o resumo da regra; casos fora do escopo listados no cabeçalho.
- `test.describe` pela rota (`"POST /accounts/{accountId}/holds"`) e sub-`describe` por grupo de regra (criação, validação do corpo, idempotência, regras de negócio).
- `test.step` para cada fase relevante do caso; variações de entrada em tabela + `for` com `test.step` por variação.
- Validação negativa termina com um **controle** positivo no limite (ex.: 32 caracteres aceitos) e com `expectBalanceUnchanged`.
- Comportamento indefinido pela spec: `test.fixme` com o motivo, nunca um teste inventado.

## Assíncrono e estado

- Espera de status: `expect.poll(..., { timeout, intervals })` em helper `waitFor*` (`tests/helpers/account/holds.ts`). Nunca `waitForTimeout`, exceto janela fixa para provar que algo **não** aconteceu.
- Teste com espera longa: `test.setTimeout(90_000)` no próprio teste.
- `fullyParallel: true`. Spec com estado compartilhado entre testes usa `test.describe.configure({ mode: "serial" })`.
- Efeitos são observados só pela API (sem banco, fila ou mocks).
- Dados de teste: cada teste abre as **próprias contas** pela API (`openAccount`/`openAccountId` em `tests/helpers/account/accounts.ts`, CPF válido aleatório, `initialDeposit` padrão 100,00; `status: "Blocked"`/`"Closed"` leva ao status pedido). Nenhum teste depende de seed, de contas configuradas ou de ordem de execução: a suíte roda contra um banco recém-criado.
- Estado global do antifraude (lista de regras e análises em memória): testes paralelos **não** alteram a lista inteira, não removem nem alteram as regras de configuração e não chamam `POST /rules/reset` nem `DELETE /analyses`. Para influenciar a decisão de uma transferência, criam uma regra própria com `id` único, escopada pelas contas recém-abertas (`sourceAccountIds`), com `amount` abaixo de `1000.00` (a regra padrão `valor-alto` vem antes na lista), e a removem no fim (`DELETE /rules/{id}`).
- Testes que precisam mexer no estado global (reset, `PUT /rules`, regras padrão, `DELETE /analyses`, `GET /analyses?take`) levam a tag `@global`: rodam no projeto `global` (1 worker, depois do projeto `api`, via `npm test`) e terminam com `POST /rules/reset`.
- Dado único por execução: `uniqueReference()`; valores monetários com `cents()` e `toBeCloseTo(x, 2)`.

## Ambientes e configuração

- Variáveis já exportadas no processo têm precedência; depois `.env.<ENV>` na raiz, se existir (`ENV` padrão `local`). Em CI basta exportar as variáveis.
- Toda variável nova: leitor tipado em `core/config/EnvironmentConfig.ts` (`env.url`, `env.required`, `env.optional`, `env.list`) + linha em `.env.example`. Valores reais nunca são commitados nem lidos pelo agente (só as chaves).
- Obrigatória nova quebra todo ambiente sem ela: prefira `optional` + `test.skip` para dados de teste; `required`/`url` só para o que toda a suíte precisa.
- Todos os erros de config aparecem de uma vez ao carregar.

## Validação

- `npm run check` (= `npm run typecheck` + `npm run lint:arch`)
- Listar testes: `npx playwright test <spec> --list`
- Rodar: `ENV=<env> npx playwright test <spec>` (os testes criam os próprios dados; contra o docker-compose local do SUT, rodar é seguro)
- Suíte completa: `npm test` (projeto `api` em paralelo e depois o projeto `global`)

## Proibições

- `@playwright/test` fora de `core/http/PlaywrightHttpClient.ts`, `fixtures/` e `playwright.config.ts` → use `HttpClient`/`HttpResponse`; em testes, `test`/`expect` de `fixtures/ApiFixtures`.
- `APIRequestContext`/`APIResponse` em interface, service, helper ou spec → use `HttpResponse` (`res.status`, `res.headers`).
- Service com `expect` ou regra de teste → mova para `tests/helpers/<domínio>/`.
- Teste ou helper importando `services/` → use a interface recebida do fixture.
- `process.env` fora de `core/config/` → `config.<chave>`.
- Schema com enum literal duplicado, `SchemaObject` solto ou `JSONSchemaType` → `defineSchema<T>()` + constante do enum.
- `waitForTimeout` para esperar estado → `expect.poll` em helper `waitFor*`.
