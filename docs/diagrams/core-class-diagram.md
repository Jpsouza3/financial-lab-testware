# HTTP Client Architecture

The following diagram shows the relationships between the core HTTP abstractions, a service and contract validation. Only `PlaywrightHttpClient` knows `APIRequestContext` (ADR-001).

```mermaid
---
config:
  theme: mc
  look: neo
  fontFamily: '''Source Code Pro Variable'', monospace'
  themeVariables:
    fontFamily: '''Source Code Pro Variable'', monospace'
---
classDiagram
direction TB
    class HttpClient {
	    +get(url, options?) HttpResponse~T~
	    +post(url, body?, options?) HttpResponse~T~
	    +put(url, body?, options?) HttpResponse~T~
	    +patch(url, body?, options?) HttpResponse~T~
	    +delete(url, options?) HttpResponse~T~
    }

    class PlaywrightHttpClient {
	    +setToken(token: string)
	    +clearToken()
	    -send(method, url, body?, options?) HttpResponse~T~
	    -toPlaywrightBody(body?) object
	    -buildHeaders(body?, options?) Record~string,string~
	    -toHttpResponse(response: APIResponse) HttpResponse~T~
    }

    class APIRequestContext {
    }

    class RequestOptions {
	    +headers?: Record~string,string~
	    +params?: Record~string,QueryValue~
	    +auth?: RequestAuth
	    +timeout?: number
    }

    class HttpResponse~T~ {
	    +status: number
	    +ok: boolean
	    +headers: Record~string,string~
	    +body: T
	    +text: string
    }

    class AccountInterface {
    }

    class AccountService {
    }

    class ContractValidator {
	    +validate(schema: Schema~T~, data: unknown)
	    +errors(schema, data) string[]
    }

    class Schema~T~ {
    }

	<<interface>> HttpClient
	<<interface>> AccountInterface

    HttpClient <|.. PlaywrightHttpClient
    PlaywrightHttpClient "1" --> "1" APIRequestContext
    HttpClient ..> RequestOptions
    HttpClient ..> HttpResponse
    AccountInterface <|.. AccountService
    AccountService --> HttpClient
    ContractValidator ..> Schema
```
