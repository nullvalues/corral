# Brief — Corral Talent

> This is a one-page project brief. It answers **what** and **why**.
> Design decisions and implementation choices belong in `docs/architecture.md`.
> Convictions, value hierarchy, and full constraint rationale live in `docs/ideology.md`.

---

## What this project produces

Corral Talent is a reusable single-page-app template paired with a working reference
implementation. It ships configured for a specific stack (React + Vite + TypeScript
+ Tailwind 4 on the UI; Fastify + Drizzle + Better Auth + Zod on the API; Vitest
+ Playwright for tests; pnpm workspaces) and demonstrates the patterns the
operator considers correct for multi-user SPAs.

---

## Why it exists

A personal reference implementation. Corral Talent captures, in working code, the
conventions the operator has converged on across previous projects (radar, aab) —
so that future projects in this family can be started from a known-disciplined
baseline rather than re-derived each time. Forks pick up the conventions; this
repo is where the conventions are maintained.

---

## Core beliefs

The full set of convictions lives in `docs/ideology.md` (Core convictions and
Value hierarchy sections). The headline:

- The reference must demonstrate the rigorous version. Downstream forks can
  relax; a slack reference cannot be tightened.
- Single seam per external concern. Defence in depth. Enforced boundaries (not
  reviewer-only). API contract as the boundary. Code that runs end-to-end.
  Locked stack.

---

## Accepted tradeoffs

- **Strict discipline over DX convenience.** Corral Talent commits to remote-only
  infrastructure, mandatory MFA, dual-layer bounds, and generated API types —
  knowing each costs developer ergonomics. The teaching value of the disciplined
  reference is worth the friction.
- **Locked stack over flexibility.** Corral Talent is opinionated about exactly which
  libraries it uses. A template that "supports any stack" teaches no concrete
  pattern; Corral Talent teaches by demonstrating one stack fully.
- **Generated `api-types.ts` over a shared package.** Trades dev-loop
  convenience (Zod schemas can't cross the boundary as code) for the cleaner
  "API is a contract" lesson and a language-agnostic server option.
- **PostgreSQL-backed sessions over Redis pub/sub.** Trades real-time fan-out
  capability for one fewer infra dependency. Forks that need pub/sub add
  Redis themselves.

---

## Constraints

These operator constraints shape every build decision in this project:

- **No billing logic.** Feature flags are admin-toggled booleans only — no
  per-seat pricing, no payment integration, no entitlement checks.
- **No local infrastructure.** Development and production both connect to the
  same remote PostgreSQL server and the same remote S3-compatible object store.
  `docker-compose` database services and local Postgres or Minio installs are
  prohibited. CI service containers are the single approved exception — they
  exist only to run integration tests in CI.
- **`process.env` containment.** Read only in `api/src/lib/config.ts`,
  `api/src/db/index.ts`, and `drizzle.config.ts`. All other files import the
  typed config object.
- **TOTP/MFA is mandatory.** Every user must enrol within the configured grace
  window. Production never runs with MFA disabled.
- **`ALLOWED_ORIGINS` is always required.** A comma-separated allow-list of UI
  origins. No wildcard CORS origin in any environment — dev, test, or
  production. The config layer exits at startup if the list is missing or empty.
  (The legacy singular `ALLOWED_ORIGIN` is still honoured as a fallback.)
- **`SESSION_SECRET` ≥64 characters, validated at startup** in every
  environment from Phase 1, before Better Auth is even wired.
- **UI never imports `api/` runtime code.** Only the generated `api-types.ts`
  crosses the boundary. The API contract IS the boundary.
- **Drizzle schema is PROTECTED.** `/api/src/db/schema/` is modified only by
  stories that explicitly name a schema change; every change generates a
  drizzle-kit migration and an ADR-style note in `docs/architecture.md`.
- **Dev port range is 6040–6049.** No Corral Talent dev process binds a port outside
  this range. (Sits adjacent to radar's 6010–6019.)

---

## Not in scope

- Billing, invoicing, or per-seat pricing of any kind
- Local Docker-based dev infrastructure (`docker-compose`, local Postgres,
  local Minio, local Redis)
- Offline-first or local-first sync
- Authentication systems other than Better Auth
- Stack divergence within Corral Talent itself — downstream forks may diverge, but the
  template's locked stack is non-negotiable for the reference
- Multi-tenant data partitioning — Corral Talent is single-tenant multi-user; a fork that
  needs workspaces inherits radar's model, not Corral Talent's

---

## What a second implementation must preserve

The irreducible requirements are listed in `docs/ideology.md` under
"Reconstruction guidance → Must preserve." An implementation that omits any of
those items is not Corral Talent.

The headline must-preserve items: Better Auth owns identity; mandatory MFA after
grace; RBAC + ABAC coexisting as separate enforcement layers; one-directional
layer model with `process.env` containment; single seam per external service;
schema PROTECTED with migrations + ADR notes; UI/API boundary via generated
`api-types.ts` only; dual-layer bounds at route + DB; no local infrastructure;
explicit CORS origin in every environment; runnable reference end-to-end;
locked stack.

---

## Operator contact

david@halfhorse.com


---

_These three documents should be sufficient for any model or toolchain to cold-start this project and reproduce a valid variant without prior session context._

- `docs/brief.md` — what and why (operator intent)
- `docs/ideology.md` — convictions, value hierarchy, accepted constraints
- `docs/architecture.md` — how and architectural decisions
