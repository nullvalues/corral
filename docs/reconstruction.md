# Reconstruction Brief — asp

> This document is the sole input for an independent reconstruction agent.
> The agent must not have access to the original source code.
> It should produce an implementation that satisfies the ideology and constraints
> recorded here — free to diverge in all other respects.

---

## What you are building

asp is a reusable single-page-app template paired with a working reference
implementation. It ships configured for a specific stack (React + Vite + TypeScript
+ Tailwind 4 on the UI; Fastify + Drizzle + Better Auth + Zod on the API; Vitest
+ Playwright for tests; pnpm workspaces) and demonstrates the patterns the
operator considers correct for multi-user SPAs.

---

## Why it exists

A personal reference implementation. asp captures, in working code, the
conventions the operator has converged on across previous projects (radar, aab) —
so that future projects in this family can be started from a known-disciplined
baseline rather than re-derived each time. Forks pick up the conventions; this
repo is where the conventions are maintained.

---

---

## Non-negotiable ideology

> These convictions and constraints must be expressed in any correct implementation.
> An implementation that contradicts them is not this project.

### Convictions



- **We prefer disciplined defaults over DX convenience**, because the reference must demonstrate the rigorous version. A downstream fork can relax a rule if it has a reason; it cannot easily upgrade a slack reference into one with conviction.

- **We prefer single seams over multiple paths**, because every external concern (storage, AI, HTTP, identity, fetch) is harder to reason about when it can be invoked through more than one route. One seam is testable, swappable, and auditable; two seams produce drift.

- **We prefer defence in depth over single-layer trust**, because bounds and ownership checks at every layer survive partial bypasses — migrations, scripts, future routes, silent drift. The convenience of single-layer enforcement is not worth the failure mode.

- **We prefer enforced boundaries over reviewer-only enforcement**, because boundaries that fail in CI are caught the first time. Boundaries that depend on review attention drift quietly between phases.

- **We prefer the API contract over shared types**, because the API surface that survives a language change is the surface the contract describes. A generated `api-types.ts` makes the contract the artefact; a shared package makes the package the artefact.

- **We prefer code that runs end-to-end over examples that document intent**, because a broken example teaches a broken pattern faster than any prose can correct it. The reference is the documentation; explanation points at code, never replaces it.

- **We prefer a locked stack over an open template**, because the consistency between asp, aab, radar, and future projects in this family IS the lesson. Stack divergence in a reference template dilutes its teaching value.

- --



### Constraints



#### Identity stack owned by Better Auth

**Rule:** Better Auth owns the users, sessions, accounts, and verification tables. No Drizzle FK references the users table; no app-side reimplementation of identity primitives. Sessions are stored in PostgreSQL via BA's DB adapter — no Redis dependency for the identity stack. Cookies are HttpOnly, Secure (production), SameSite=Lax.

**Why this constraint exists:** Identity is high-risk surface area. Owning the schema duplicates work BA already does correctly and introduces drift between asp's model and BA's evolving defaults. DB-backed sessions trade Redis pub/sub for one fewer infra dependency — a template should pin minimum infrastructure.


#### Mandatory MFA after grace window

**Rule:** Every user must enrol a TOTP factor within the configured grace window after signup. After the window expires, unverified accounts cannot reach any authenticated app surface — they are routed to enrolment.

**Why this constraint exists:** MFA is the cheap intervention with the highest ROI. A grace window balances onboarding friction with the discipline of universal MFA — newcomers can try the app once, but anyone returning must have enrolled. The reference demonstrates the harder-to-bypass version.


#### SESSION_SECRET strong and validated at startup

**Rule:** `api/src/lib/config.ts` validates `SESSION_SECRET` ≥64 characters at startup in every environment from Phase 1. Rotation procedure is documented in `docs/architecture.md` and includes guidance to rotate on each production deploy when realistically possible.

**Why this constraint exists:** Failing fast at startup prevents the "we'll fix it later" path where a development-grade secret reaches production. Validating from Phase 1 — before BA is even wired — establishes the stub pattern and the env-file discipline early.


#### Auth model coexistence — RBAC + ABAC

**Rule:** asp's reference demonstrates both auth models. System-level controls (admin functions, org content) use RBAC. User-authored content (posts, items, files) uses ABAC. The two layers are separately enforced — there is no combined `canAccess(user, resource)` function that mixes role membership with ownership predicates. Each story spec that touches an auth-gated resource names the resource type's governing model before build.

**Why this constraint exists:** See `~/.claude/policies/auth-coexistence.md`. Single-tenant multi-user apps almost always need both; conflation is the most common failure mode.


#### One-directional layer model + env containment

**Rule:** Dependencies in the API flow `routes/ → services/ → db/` only. `routes/` and any future agent-tool layer never import from `db/`. `services/` never imports from `routes/`. `process.env` is read only in `api/src/lib/config.ts`, `api/src/db/index.ts`, and `drizzle.config.ts`. All other code imports the typed config object.

**Why this constraint exists:** Upward imports couple lower layers to higher ones and erase the layering. process.env scattered across files makes the env surface non-auditable and tests harder to isolate. Both rules together produce a codebase where any layer can be reasoned about without loading the layer above it.


#### Zod validation on every mutating body

**Rule:** Every POST, PATCH, and PUT request body is validated through a Zod schema via `fastify-type-provider-zod` before reaching service code. No `request.body as Foo` casts anywhere. Route handler types are derived from the schema, not declared separately.

**Why this constraint exists:** A request body that bypasses validation is a typed lie. Zod via the type provider makes validation and types the same artefact — drift is structurally impossible.


#### Single seam per external service

**Rule:** Every external service is reached through exactly one interface defined in `api/src/lib/`. Initial seams: `StorageClient` (S3-compatible object store, in `lib/storage.ts`) and `AiClient` (LLM provider, in `lib/ai.ts`). No route, service, or agent tool imports the underlying SDK (`@aws-sdk/*`, `@anthropic-ai/sdk`, etc.) directly. New external dependencies follow the same pattern.

**Why this constraint exists:** Two paths to the same external service produce drift. One seam means the seam can be mocked uniformly in tests and replaced uniformly in production.


#### API entry-point split

**Rule:** `api/src/app.ts` exports `buildApp()`, which constructs the Fastify instance and registers all routes and plugins. It performs no I/O — no DB calls, no Redis (n/a for asp), no network. `api/src/index.ts` is the process entry point only: it calls `buildApp()`, verifies DB and storage connectivity, registers OS signal handlers, and calls `listen()`. `index.ts` may contain no other logic.

**Why this constraint exists:** A monolithic entry point couples test fixtures to infra; splitting makes the entire app independently testable.


#### Drizzle schema is PROTECTED

**Rule:** `/api/src/db/schema/` is modified only when a story explicitly names a schema change. Every schema change generates a drizzle-kit migration AND adds an ADR-style note to `docs/architecture.md` explaining the design decision. The `.claude/settings.json` deny list blocks unscoped writes; the reviewer enforces the ADR note.

**Why this constraint exists:** The schema is the longest-lived artefact in the codebase. Decisions that look obvious in the moment look arbitrary six months later without a recorded rationale.


#### UI never reaches the DB directly

**Rule:** The UI package consumes the API via HTTP and WebSocket only. UI imports only `api-types.ts`, which is generated from the API's OpenAPI schema. UI never imports runtime code from `api/`. The API contract IS the boundary.

**Why this constraint exists:** A shared-package boundary teaches "share a TypeScript module"; an OpenAPI-generated boundary teaches "the API is a contract." Only the second lesson is transferable to a non-TS server. asp prefers the transferable lesson.


#### Bounds at route + DB

**Rule:** Every bounded numeric value has BOTH a Zod schema bound at the route layer AND a DB CHECK constraint at the database layer. Every text column has a max-length CHECK constraint. The two bounds must agree; the reviewer flags drift.

**Why this constraint exists:** Defence-in-depth is the lesson the reference exists to teach. A single-layer bound is convenient until something bypasses it; by then the corruption is already in production.


#### Soft-reference arrays are a smell

**Rule:** `uuid[]` or `text[]` columns that conceptually reference other rows are preferred-against. Default to a proper join table. When a soft-reference array is genuinely warranted (ordering matters in the same row, cross-aggregate references where FK would create a cycle, etc.), the service layer validates every referenced ID at write time, and the choice is recorded in `architecture.md`.

**Why this constraint exists:** Most uses of soft-reference arrays are convenience over correctness. The reference template should default to the disciplined shape.


#### No local infrastructure (CI excepted)

**Rule:** No local-infrastructure docker-compose, no local Postgres, no local Minio. Development and production connect to the same remote PostgreSQL server and remote S3-compatible object store. `.env.example` ships with empty placeholders; the developer fills `.env` with real remote credentials provided out of band. The single approved exception is CI service containers: GitHub Actions may use a Postgres service container because CI is neither development nor production.

**Why this constraint exists:** Local Docker for infrastructure introduces a third environment that behaves subtly differently from the other two. The reference template demonstrates that the third environment is unnecessary. A production-deployment compose file with an external DB enforces the same topology — it does not introduce a third environment.


#### Pinned dev port range 6040–6049

**Rule:** All asp dev servers (API, UI, future services) bind ports in 6040–6049. The mapping is recorded in `docs/architecture.md`. No asp dev process uses a port outside this range.

**Why this constraint exists:** Port collisions waste time; a pinned range is one line of configuration to set and zero lines of debugging.


#### CORS: explicit origin always

**Rule:** `ALLOWED_ORIGINS` (a comma-separated allow-list) is always required, in every environment. There is no wildcard origin default. A single URL is a one-element list; multiple origins are comma-separated. `.env.example` sets it to the local UI origin (e.g. `http://localhost:6041`). The config layer exits if it is unset or empty. The legacy singular `ALLOWED_ORIGIN` is read as a fallback (deprecated).

**Why this constraint exists:** A wildcard dev default trains developers to ignore the setting; when production demands a real value, the muscle memory is absent. Forcing the value from day one keeps it visible.


#### Tests never require live infrastructure (unit); CI does (integration)

**Rule:** Unit tests import `buildApp()` and inject mock implementations of every single-seam interface (`StorageClient`, `AiClient`, etc.) via DI. They never touch a real DB or external service. Integration tests connect to `DATABASE_URL_TEST` and run against a real Postgres; CI provisions one via a GitHub Actions service container. There is no graceful-skip path for integration tests — if the test suite is run, the integration suite runs, and CI never ships green without it.

**Why this constraint exists:** Graceful-skip patterns hide real failures behind environmental asymmetry. Forcing CI to run the real suite means the test signal is honest.


#### CI: per-package typecheck, test, lint as separate named steps

**Rule:** Each workspace package's typecheck, test, and lint runs as its own named step in `.github/workflows/ci.yml`, with its own `env:` block. A failed step name points directly at the broken package and command. The root `pnpm test` convenience script may exist for local use; it is not what CI runs.

**Why this constraint exists:** CI is the longest-running gate in the workflow; making its output faster to read is high-leverage.


#### Tailwind theme tokens only

**Rule:** All colours, spacing, and theming flow through Tailwind's theme configuration. No inline hex literals. No raw CSS custom properties. The reviewer flags any hex string in a component file.

**Why this constraint exists:** Tailwind 4's theme model is sufficient. A second theming layer (raw CSS variables) duplicates the surface and produces drift.


#### Client state architecture: server in React Query, client in Zustand

**Rule:** All HTTP traffic from the UI to the API goes through TanStack Query (`@tanstack/react-query`). There is no hand-rolled `apiFetch` and no raw `fetch()` to API URLs. 401 responses are handled in QueryClient default options, which trigger the re-auth flow. Server state (anything that round-trips the API) lives in React Query's cache. Client state (modal open/closed, UI mode, ephemeral selections) lives in Zustand. A Zustand store never duplicates data that React Query already owns.

**Why this constraint exists:** The two-store split (radar's `store/`/`state/` pattern) fights a synchronisation problem React Query already solves. Using each tool for its intended job removes the problem.


#### The reference always runs end-to-end

**Rule:** Every committed example boots, builds, type-checks, and passes tests. A broken example is a broken lesson — it is fixed in the same commit or removed before merge. There is no "TODO: this part doesn't work yet" path for committed reference code.

**Why this constraint exists:** asp's purpose is to be a working reference. A non-working reference is worse than no reference at all, because it looks authoritative.


#### Stack is locked

**Rule:** asp's stack is React 19 + Vite + TypeScript + Tailwind 4 (UI), Fastify + Drizzle ORM + Better Auth + Zod (API), Vitest + Playwright (tests), pnpm workspaces. Downstream forks may diverge; asp itself does not.

**Why this constraint exists:** Stack divergence in a reference template fragments the lessons it teaches. The same patterns must be expressible in the same idioms.




---

## What must survive any implementation



- Better Auth owns the identity stack; no app-side users table or session store.

- TOTP/MFA is mandatory after a configured grace window.

- SESSION_SECRET is validated ≥64 chars at startup.

- RBAC and ABAC coexist as separately-enforced layers; no combined access check.

- The layer model is one-directional; `process.env` containment is enforced.

- Every mutating body is Zod-validated; types derive from schemas.

- Every external service has exactly one seam interface.

- `app.ts` performs no I/O; `index.ts` is the process boot only.

- Schema is PROTECTED; every change generates a migration and an ADR note.

- UI consumes the API contract via generated `api-types.ts` only.

- Numeric and text bounds are enforced at both route and DB layers.

- No local infrastructure (Docker, local DB, local object store) is used.

- CORS requires an explicit origin in every environment.

- Unit tests use DI mocks; CI runs integration tests against a real DB; no skip.

- CI runs per-package steps separately.

- All theming flows through Tailwind tokens.

- All UI HTTP goes through React Query; Zustand owns client state only.

- Every committed example runs end-to-end.

- The stack is locked at the asp level.



---

## What you are free to change

> These are fingerprints of the original implementation, not constraints.
> You are encouraged to find better approaches.



- Specific Zustand store names and file layout — the discipline is "client state only in Zustand," not "named exactly this way."

- Component file structure within `ui/src/components/` — feature folders, flat layout, or another scheme is fine as long as theme tokens and React Query rules hold.

- Test file naming (`*.test.ts` vs `*.spec.ts`) — pick one and be consistent.

- Specific Drizzle helper patterns (relations API vs query API) — both are acceptable; pick per query and document the choice if non-obvious.

- The grace-window duration for MFA enrolment — the existence of the window is the constraint; its length is configurable.

- Which S3-compatible provider — the StorageClient seam is the constraint; the underlying provider (Minio, R2, S3, B2) is free.

- --



---

## Comparison rubric

> After building, your implementation will be evaluated against the original on
> these dimensions. Optimise for them explicitly.



- **Boundary enforcement:** — does each layer rule (routes/services/db, env containment, UI/API separation, single seam per external service) hold without exception? Is the enforcement structural (CI test, deny list, generated artefact) or human (reviewer attention)? Structural wins.

- **Defence-in-depth coverage:** — does every bound that could meaningfully exist at two layers exist at two layers? Are the two layers in agreement, or has drift opened a gap?

- **Reference fidelity:** — does every committed example actually run? Is the documentation pointing at code, or does the prose stand alone? A reader who copies any example into their own project — does it work?

- **Auth-model separability:** — can the RBAC layer and the ABAC layer be reasoned about independently? Is there exactly one place where each kind of check happens, or has the boundary smeared?

- **Stack and contract legibility:** — would a downstream fork that reads `architecture.md` and `api-types.ts` (or the OpenAPI spec) be able to reimplement the server in another language without losing fidelity?



---

## What you should question

> The original implementation made these choices under time or knowledge constraints.
> You are encouraged to find better solutions and justify them against the convictions above.



- **The 64-char SESSION_SECRET floor** — radar uses 32. The doubled minimum is cheap insurance, but if it produces friction (e.g. operator pushback on rotation procedures), the right move may be to drop to 48 with clearer rotation guidance, not to weaken validation.

- **Hard remote-only with no local Docker** — this is the most opinionated stance in the ideology. For some downstream forks (open-source projects expecting community contributors who can't be given remote credentials) the right answer is a docker-compose fallback. asp commits to the harder rule; forks may not.

- **TanStack Query as the sole HTTP seam** — radar's hand-rolled `apiFetch` has more direct test ergonomics in some scenarios (event dispatch is easier to observe than QueryClient defaults). If 401 UX becomes hard to test, revisit.



---

## Instructions for the reconstruction agent

1. Read this document in full before writing any code.
2. Build a working implementation that satisfies the ideology above.
3. For every non-negotiable constraint: explicitly state how your implementation satisfies it.
4. For every "should question" item: either improve on it or justify why you kept the
   original approach, citing the relevant conviction.
5. For every comparison dimension: document your approach and how it scores against the rubric.
6. Do not look at the original source code. If you have seen it, declare that before starting.
7. When done, produce a `RECONSTRUCTION.md` at your project root scoring your implementation
   against each comparison dimension.

*Generated from `docs/ideology.md` and `docs/brief.md` by `/flex:pairmode reconstruct`.*
*Original project: asp*
*Generated: 2026-06-01*
