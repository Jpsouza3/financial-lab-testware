# ADR-001 - HTTP Client Abstraction (Adapter)

## Context

The service layer requires an HTTP client to communicate with external APIs.

Depending directly on Playwright's `APIRequestContext` would couple the business logic to a specific HTTP library, making it harder to replace the implementation or reuse the services with another transport layer.

The first version of the port still leaked Playwright: `HttpResponse.raw` was an `APIResponse`, so interfaces, services, helpers and tests read the status through Playwright (`res.raw.status()`).

## Decision

- `HttpClient` (`core/http/HttpClient.ts`) is the project's HTTP port: `get`, `post`, `put`, `patch`, `delete`, returning `HttpResponse<T>`. It never throws on status codes.
- `HttpResponse<T>` is library-agnostic: `{ status, ok, headers, body, text }`. No Playwright type crosses the port.
- `PlaywrightHttpClient` is the adapter: it is the only file in `core/` that imports `@playwright/test`. It maps `RequestBody` (`json`, `form`, `multipart`, `text`) and `RequestOptions` (`headers`, `params`, `auth`, `timeout`) to `APIRequestContext.fetch`, and parses the body once (JSON, text, or `undefined` when empty).
- `fixtures/ApiFixtures.ts` is the composition root: it wires `APIRequestContext → PlaywrightHttpClient → Service` and exposes the domain **interface** to tests.
- `npm run lint:arch` (`scripts/check-architecture.ts`) enforces the dependency rules.

## Consequences

### Positive

- Services, interfaces, helpers and tests depend on abstractions only (DIP); a new HTTP library only needs a new adapter and fixture wiring.
- HTTP concerns (headers, auth, body encoding, parsing) live in one place.
- Status/headers are plain values: simpler assertions (`res.status`, `res.headers["location"]`).

### Negative

- Playwright-specific response features (e.g. `response.body()` as `Buffer`, `securityDetails()`) are not reachable from tests; add a field to `HttpResponse` if one becomes necessary.
- Every new HTTP library requires its own adapter implementation.
