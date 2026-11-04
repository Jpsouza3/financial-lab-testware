# ADR-001 - HTTP Client Abstraction

## Context

The service layer requires an HTTP client to communicate with external APIs.

Depending directly on Playwright's `APIRequestContext` would couple the business logic to a specific HTTP library, making it harder to replace the implementation or reuse the services with another transport layer.

## Decision

Introduce an `HttpClient` interface that defines the project's HTTP contract.

Provide `PlaywrightHttpClient` as the first implementation, adapting Playwright's `APIRequestContext` to this contract.

## Consequences

### Positive

- Service layer depends on an abstraction instead of Playwright. (OCP)
- Additional HTTP implementations can be introduced without changing the service layer. (OCP)
- HTTP concerns are centralized in a dedicated adapter. (Adapter Pattern)

### Negative

- Introduces one additional abstraction.
- Every new HTTP library requires its own adapter implementation.