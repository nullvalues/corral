---
id: "001"
name: asp — Initial development
status: complete
---

## Strategic intent

Build a personal reference SPA template that captures the conventions the operator has converged on across previous projects — so future projects can fork from a known-disciplined baseline rather than re-deriving the stack each time. The reference implementation exercises the full stack end-to-end: auth, CRUD, RBAC/ABAC, CI, containerised deployment, and E2E test coverage.

## Rails

| Rail | Primary domain |
|------|----------------|
| API | Fastify route handlers, Zod validation, API-layer business logic |
| UI | React 19 + Vite frontend components, pages, and TanStack Query hooks |
| DB | Drizzle ORM schema, migrations, seed scripts |
| AUTH | Better Auth integration, mandatory TOTP MFA, session and RBAC enforcement |
| INFRA | pnpm workspace setup, CI/CD workflows, Docker and docker-compose deployment |
| TEST | Playwright E2E suites, integration test harness, Vitest component tests |
| ADR | Architecture Decision Records |

## Phases

| Phase | Title | Status |
|-------|-------|--------|
| 1 | Workspace + harness | complete |
| 2 | DB + Better Auth + mandatory MFA | complete |
| 3 | TanStack Query + auth UI | complete |
| 4 | RBAC + ABAC scaffolding | complete |
| 4.5 | Test-DB harness & integration baseline remediation | complete |
| 5 | Experience schema | complete |
| 6 | Experience CRUD API | complete |
| 7 | Experience UI for applicants | complete |
| 8 | Admin + Mentor UI | complete |
| 9 | Production build seam (API serves UI) | complete |
| 10 | Migration runner, prod seed, admin CLI, rate limiting, open CERs | complete |
| 11 | Email seam + password reset | complete |
| 12 | Dockerfile + docker-compose deployment | complete |
| 13 | Playwright E2E in CI | complete |
| 14 | E2E password-reset coverage + CER backlog closeout | complete |
