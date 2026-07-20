# Ideology — Corral Talent

> This document captures the **intent layer** beneath the implementation.
> It records convictions, tradeoffs, and constraints in a form that survives across
> implementations and rewrites — the "why" behind each rule in `docs/architecture.md`,
> kept in one place instead of scattered across commit messages.
>
> Corral Talent is a reusable SPA template with a working reference implementation. It
> teaches by example: the code that ships IS the lesson. The disciplines below are
> stricter than what most downstream forks will retain — that asymmetry is deliberate.
> A rigorous reference can be relaxed by a fork; a slack reference cannot be tightened.

---

## Core convictions

- **We prefer disciplined defaults over DX convenience**, because the reference must
  demonstrate the rigorous version. A downstream fork can relax a rule if it has a
  reason; it cannot easily upgrade a slack reference into one with conviction.

- **We prefer single seams over multiple paths**, because every external concern
  (storage, AI, HTTP, identity, fetch) is harder to reason about when it can be
  invoked through more than one route. One seam is testable, swappable, and
  auditable; two seams produce drift.

- **We prefer defence in depth over single-layer trust**, because bounds and ownership
  checks at every layer survive partial bypasses — migrations, scripts, future routes,
  silent drift. The convenience of single-layer enforcement is not worth the failure
  mode.

- **We prefer enforced boundaries over reviewer-only enforcement**, because boundaries
  that fail in CI are caught the first time. Boundaries that depend on review attention
  drift quietly over time.

- **We prefer the API contract over shared types**, because the API surface that
  survives a language change is the surface the contract describes. A generated
  `api-types.ts` makes the contract the artefact; a shared package makes the
  package the artefact. Hooks that call GET endpoints must type their `queryFn`
  return value using `paths[...]['get']['responses'][200]['content']['application/json']`
  from the generated `api-types.ts` — not a locally-declared interface and not `unknown`.

- **We prefer code that runs end-to-end over examples that document intent**, because
  a broken example teaches a broken pattern faster than any prose can correct it.
  The reference is the documentation; explanation points at code, never replaces it.

- **We prefer a locked stack over an open template**, because stack consistency across
  a reference template's lifetime IS the lesson. Stack divergence in a reference
  template dilutes its teaching value.

---

## Value hierarchy

- **Discipline over DX convenience** — when a rule costs ergonomics, write the rule.
  The reference exists to demonstrate the disciplined version; ergonomics belong in
  downstream forks that have a specific cost reason to relax.

- **Boundary enforcement over local convenience** — a routing trick that bypasses a
  layer rule is a regression, even if it ships faster. CI gates and deny lists win
  against "just this once."

- **Reference fidelity over feature breadth** — the reference does fewer things,
  fully, before it does more things shallowly. A half-finished example is removed,
  not committed with a TODO.

- **Single source of truth over redundant convenience** — when two places hold the
  same fact (env values, type definitions, validation bounds, role constants), pick
  the canonical one and route everything through it. Redundancy is not safety; it
  is drift in slow motion.

---

## Accepted constraints

### Identity stack owned by Better Auth

**Rule:** Better Auth owns the users, sessions, accounts, and verification tables.
No Drizzle FK references the users table; no app-side reimplementation of identity
primitives. Sessions are stored in PostgreSQL via BA's DB adapter — no Redis dependency
for the identity stack. Cookies are HttpOnly, Secure (production), SameSite=Lax.

**Protects:** Identity stack integrity, BA upgrade path, session-store portability.

**Rationale:** Identity is high-risk surface area. Owning the schema duplicates work
BA already does correctly and introduces drift between Corral Talent's model and BA's
evolving defaults. DB-backed sessions trade Redis pub/sub for one fewer infra
dependency — a template should pin minimum infrastructure.

**Override path:** No override for BA ownership of identity. A downstream fork that
needs Redis-backed sessions (for scale or pub/sub) may swap; Corral Talent itself
does not.

---

### Mandatory MFA after grace window

**Rule:** Every user must enrol a TOTP factor within the configured grace window
after signup. After the window expires, unverified accounts cannot reach any
authenticated app surface — they are routed to enrolment.

**Protects:** Account takeover via password-only auth, especially for accounts that
sit dormant after signup.

**Rationale:** MFA is the cheap intervention with the highest ROI. A grace window
balances onboarding friction with the discipline of universal MFA — newcomers can
try the app once, but anyone returning must have enrolled. The reference demonstrates
the harder-to-bypass version.

**Override path:** No override. The grace-window duration is configurable; the
mandate is not.

---

### SESSION_SECRET strong and validated at startup

**Rule:** `api/src/lib/config.ts` validates `SESSION_SECRET` ≥64 characters at startup
in every environment. Rotation procedure is documented in `docs/architecture.md` and
includes guidance to rotate on each production deploy when realistically possible.

**Protects:** Session integrity. A weak or static secret is silently catastrophic —
forged sessions are indistinguishable from real ones.

**Rationale:** Failing fast at startup prevents the "we'll fix it later" path where
a development-grade secret reaches production. Validating from day one — before BA
is even wired — establishes the env-file discipline early.

**Override path:** No override on length or startup validation. Rotation cadence is
operational guidance, not a hard rule.

---

### Auth model coexistence — RBAC + ABAC

**Rule:** Corral Talent's reference demonstrates both auth models. System-level controls
(admin functions, org content) use RBAC. User-authored content (posts, items, files)
uses ABAC. The two layers are separately enforced — there is no combined
`canAccess(user, resource)` function that mixes role membership with ownership
predicates. Each auth-gated resource has a documented, single governing model.

**Protects:** Auditability. A role check and an ownership check may both return
`true`, but for separately auditable reasons. A combined check cannot be independently
tested or reasoned about.

**Rationale:** Single-tenant multi-user apps almost always need both role-based and
ownership-based access control; conflation of the two is the most common access-control
failure mode — a check that happens to pass for the right reason today can pass for
the wrong reason after the next refactor.

**Override path:** No override. A resource type may be governed by exactly one model
at a time; mixing them in a single check is the anti-pattern this rule exists to prevent.

---

### One-directional layer model + env containment

**Rule:** Dependencies in the API flow `routes/ → services/ → db/` only.
`routes/` never imports from `db/`. `services/` never imports from `routes/`.
`process.env` is read only in `api/src/lib/config.ts`, `api/src/db/index.ts`, and
`drizzle.config.ts`. All other code imports the typed config object.

**Protects:** Testability (services testable without HTTP), refactor safety
(swapping the HTTP framework affects routes only), single-source-of-truth for env
configuration.

**Rationale:** Upward imports couple lower layers to higher ones and erase the
layering. `process.env` scattered across files makes the env surface non-auditable
and tests harder to isolate. Both rules together produce a codebase where any layer
can be reasoned about without loading the layer above it.

**Override path:** No override. A CI structural test enforces both rules; violation
fails the build.

---

### Zod validation on every mutating body

**Rule:** Every POST, PATCH, and PUT request body is validated through a Zod schema
via `fastify-type-provider-zod` before reaching service code. No
`request.body as Foo` casts anywhere. Route handler types are derived from the
schema, not declared separately.

**Protects:** Input integrity at the API boundary; type safety from the wire inward.

**Rationale:** A request body that bypasses validation is a typed lie. Zod via the
type provider makes validation and types the same artefact — drift is structurally
impossible.

**Override path:** No override.

---

### Single seam per external service

**Rule:** Every external service is reached through exactly one interface defined in
`api/src/lib/`. Initial seams: `StorageClient` (S3-compatible object store, in
`lib/storage.ts`) and `AiClient` (LLM provider, in `lib/ai.ts`). No route, service,
or agent tool imports the underlying SDK (`@aws-sdk/*`, `@anthropic-ai/sdk`, etc.)
directly. New external dependencies follow the same pattern.

**Protects:** Provider swap, test isolation via DI, single audit surface per external
concern.

**Rationale:** Two paths to the same external service produce drift. One seam means
the seam can be mocked uniformly in tests and replaced uniformly in production.

**Override path:** No override. New external services add a new lib seam; they do
not bypass it.

---

### API entry-point split

**Rule:** `api/src/app.ts` exports `buildApp()`, which constructs the Fastify
instance and registers all routes and plugins. It performs no I/O — no DB calls,
no Redis, no network. `api/src/index.ts` is the process entry point only: it calls
`buildApp()`, verifies DB and storage connectivity, registers OS signal handlers,
and calls `listen()`. `index.ts` may contain no other logic.

**Protects:** Tests import `buildApp()` and stub env vars without ever needing live
infrastructure. The boundary between "what the app is" and "how the app boots" is
visible in the file structure.

**Rationale:** A monolithic entry point couples test fixtures to infra; splitting
makes the entire app independently testable.

**Override path:** No override.

---

### Drizzle schema is PROTECTED

**Rule:** `/api/src/db/schema/` is modified only deliberately, never as a drive-by
change. Every schema change generates a drizzle-kit migration AND adds an ADR-style
note to `docs/architecture.md` explaining the design decision. Code review enforces
the ADR note.

**Protects:** Schema drift, undocumented migrations, ad-hoc field additions that
accumulate without intent.

**Rationale:** The schema is the longest-lived artefact in the codebase. Decisions
that look obvious in the moment look arbitrary six months later without a recorded
rationale.

**Override path:** No override on the protection or the migration; the ADR note may
be a single sentence for trivial changes, but must exist.

---

### UI never reaches the DB directly

**Rule:** The UI package consumes the API via HTTP and WebSocket only. UI imports
only `api-types.ts`, which is generated from the API's OpenAPI schema. UI never
imports runtime code from `api/`. The API contract IS the boundary.

**Protects:** API-as-contract discipline, language-agnostic server (UI could be
served by a non-TypeScript backend), generated-type drift caught at type-check.

**Rationale:** A shared-package boundary teaches "share a TypeScript module"; an
OpenAPI-generated boundary teaches "the API is a contract." Only the second lesson
is transferable to a non-TS server. Corral Talent prefers the transferable lesson.

**Override path:** No override.

---

### Bounds at route + DB

**Rule:** Every bounded numeric value has BOTH a Zod schema bound at the route layer
AND a DB CHECK constraint at the database layer. Every text column has a max-length
CHECK constraint. The two bounds must agree.

**Protects:** Data integrity against bypass paths (migrations, scripts, future routes,
direct DB writes), and unbounded TEXT columns as a DoS surface for downstream tooling.

**Rationale:** Defence-in-depth is the lesson the reference exists to teach. A
single-layer bound is convenient until something bypasses it; by then the corruption
is already in production.

**Override path:** No override on dual-layer numeric bounds. Text length: a column
genuinely unbounded by design (rare) must say so explicitly in `architecture.md`.

---

### Soft-reference arrays are a smell

**Rule:** `uuid[]` or `text[]` columns that conceptually reference other rows are
preferred-against. Default to a proper join table. When a soft-reference array is
genuinely warranted (ordering matters in the same row, cross-aggregate references
where FK would create a cycle, etc.), the service layer validates every referenced
ID at write time, and the choice is recorded in `architecture.md`.

**Protects:** Referential integrity. A soft array can hold dangling IDs forever
without the database noticing.

**Rationale:** Most uses of soft-reference arrays are convenience over correctness.
The reference template should default to the disciplined shape.

**Override path:** Conditional — soft-reference arrays are allowed when documented
in `architecture.md` with a reason that survives review.

---

### No local infrastructure (CI excepted)

**Rule:** No local-infrastructure docker-compose, no local Postgres, no local Minio.
Development and production connect to the same remote PostgreSQL server and remote
S3-compatible object store. `.env.example` ships with empty placeholders; the developer
fills `.env` with real remote credentials provided out of band. The single approved
exception is CI service containers: GitHub Actions may use a Postgres service container
because CI is neither development nor production.

A `docker-compose.yml` for **production deployment of the app layer** is permitted,
provided it contains no database service and requires an external Postgres instance —
this enforces production topology rather than introducing a local third environment.

**Protects:** Dev/prod parity. A bug that only reproduces against the real Postgres
version is found in dev, not in production.

**Rationale:** Local Docker for infrastructure introduces a third environment that
behaves subtly differently from the other two. The reference template demonstrates
that the third environment is unnecessary. A production-deployment compose file with
an external DB enforces the same topology — it does not introduce a third environment.

**Override path:** No override on local-infra docker-compose (local Postgres, Minio,
Redis). Two approved exceptions: (1) CI service container — narrow, covers integration
test execution only; (2) production-deployment `docker-compose.yml` that is
app-layer-only with an external DB.

---

### Pinned dev port range 6080–6089

**Rule:** All Corral Talent dev servers (API, UI, future services) bind ports in
6080–6089. The mapping is recorded in `docs/architecture.md`. No Corral Talent dev
process uses a port outside this range.

**Protects:** A collision-free dev environment when Corral Talent runs alongside
other projects sharing the same developer machine.

**Rationale:** Port collisions waste time; a pinned range is one line of
configuration to set and zero lines of debugging.

**Override path:** No override within Corral Talent. Stub values in non-connecting
scripts (e.g. OpenAPI generation scripts) may reference localhost with arbitrary
ports because they never open a real connection.

---

### CORS: explicit origin always

**Rule:** `ALLOWED_ORIGINS` (a comma-separated allow-list) is always required, in
every environment. There is no wildcard origin default. A single URL is a
one-element list; multiple origins are comma-separated. `.env.example` sets it to
the local UI origin (e.g. `http://localhost:6081`). The config layer exits if it
is unset or empty. The legacy singular `ALLOWED_ORIGIN` is read as a fallback
(deprecated).

**Protects:** CORS awareness from day one; production deployments that forget to
set an origin fail fast at startup.

**Rationale:** A wildcard dev default trains developers to ignore the setting;
when production demands a real value, the muscle memory is absent. Forcing the
value from day one keeps it visible.

**Override path:** No override.

---

### Automated tests gate human UAT; seed processes are idempotent

**Rule:** Human UAT begins only after Playwright E2E tests for all deterministic workflows
pass. Every login flow, TOTP challenge, role-based access path, basic CRUD operation, and
logout is an automated test — not a manual step. Human reviewers judge UX that cannot be
programmatically detected: layout, feel, accessibility, subjective quality. They do not
catch login failures.

Test seed scripts (`seed.uat.ts`) delete-and-recreate accounts on every run — not
insert-and-skip. Each run produces an identical, known state. TOTP secrets are written to
a deterministic sidecar location so the session-setup driver generates valid codes
regardless of whether the account is enrolling for the first time or returning with a
factor already configured. A seed that produces different behaviour on re-run is a
side-effect, not a seed.

**Protects:** The signal value of human UAT. If a human is the first to discover a login
failure, the automated test suite has failed at its job. Human attention is too expensive
to spend on things a program can verify in 30 seconds.

**Rationale:** The reference demonstrates the disciplined version. In the disciplined
version, automated E2E tests are a hard gate, not a nice-to-have. The boundary between
"what a machine can verify" and "what a human must judge" is sharp and respected in both
directions.

**Override path:** No override on the gating relationship. The scope of what counts as
"deterministic workflow" may be debated; the principle that machines verify it first is not.

---

### Tests never require live infrastructure (unit); CI does (integration)

**Rule:** Unit tests import `buildApp()` and inject mock implementations of every
single-seam interface (`StorageClient`, `AiClient`, etc.) via DI. They never touch
a real DB or external service. Integration tests connect to `DATABASE_URL_TEST` and
run against a real Postgres; CI provisions one via a GitHub Actions service
container. There is no graceful-skip path for integration tests — if the test
suite is run, the integration suite runs, and CI never ships green without it.

**Protects:** Test-suite trustworthiness. A skipped test that should have failed
ships a bug.

**Rationale:** Graceful-skip patterns hide real failures behind environmental
asymmetry. Forcing CI to run the real suite means the test signal is honest.

**Override path:** No override. A developer who cannot run integration tests
locally because they lack `DATABASE_URL_TEST` is expected to run them in CI before
merging.

---

### CI: per-package typecheck, test, lint as separate named steps

**Rule:** Each workspace package's typecheck, test, and lint runs as its own named
step in `.github/workflows/ci.yml`, with its own `env:` block. A failed step name
points directly at the broken package and command. The root `pnpm test` convenience
script may exist for local use; it is not what CI runs.

**Protects:** Failure attribution. A red CI job with one failing step is faster
to triage than a red job whose log must be searched.

**Rationale:** CI is the longest-running gate in the workflow; making its output
faster to read is high-leverage.

**Override path:** No override.

---

### Tailwind theme tokens only

**Rule:** All colours, spacing, and theming flow through Tailwind's theme
configuration. No inline hex literals. No raw CSS custom properties outside the
theme file itself.

This rule extends to Tailwind arbitrary-value utilities: a raw color literal inside
`shadow-[...]`, `bg-[...]`, or `text-[...]` (e.g. `rgba(20,15,10,0.18)`) is
equivalent to an inline hex literal for enforcement purposes. The color value must
reference a `@theme` token via `var(--color-*)` (e.g. `shadow-[0_50px_90px_var(--color-shadow-warm)]`).
If a desired shadow or gradient color has no token, create one before using it.

Standard Tailwind palette utilities (e.g. `text-green-600`, `text-red-600`) are not
inline hex literals but still bypass the `@theme` token system and are equally
forbidden in component source. Use `@theme`-defined tokens for all status colours:
`text-success-500` / `text-danger-500`, not `text-green-600` / `text-red-600`.

**Protects:** Theme consistency, single-source dark/light mode, downstream forks
that need to rebrand without touching components.

**Rationale:** Tailwind 4's theme model is sufficient. A second theming layer (raw
CSS variables) duplicates the surface and produces drift. Arbitrary-value syntax
bypasses the same guard if the value is a raw color rather than a token reference.

**Override path:** No override.

---

### Client state architecture: server in React Query, client in Zustand

**Rule:** All HTTP traffic from the UI to the API goes through TanStack Query
(`@tanstack/react-query`). The single transport seam beneath every `queryFn` /
`mutationFn` is `ui/src/lib/apiFetch.ts` — the canonical fetch wrapper that all
hooks call; raw `fetch()` to API URLs does not appear in `ui/src/hooks/`. This
is a thin transport helper, not a hand-rolled cache layer: it holds no state and
performs no caching (TanStack Query still owns all server state), and it guarantees
the `{ status, body }` error shape at one throw site. 401 responses are handled in
QueryClient default options, which trigger the re-auth flow. Server state (anything
that round-trips the API) lives in React Query's cache. Client state (modal
open/closed, UI mode, ephemeral selections) lives in Zustand. A Zustand store never
duplicates data that React Query already owns.

**Protects:** Cache-coherence bugs from dual-stored server state, single 401 handling
path, single auth-failure UX.

**Rationale:** A two-store split where server data is also mirrored into a client
store fights a synchronisation problem React Query already solves. Using each tool
for its intended job removes the problem.

**Override path:** No override.

---

### The reference always runs end-to-end

**Rule:** Every committed example boots, builds, type-checks, and passes tests.
A broken example is a broken lesson — it is fixed in the same commit or removed
before merge. There is no "TODO: this part doesn't work yet" path for committed
reference code.

**Protects:** The teaching value of the reference. Downstream forks that copy a
broken example carry the breakage forward without realising it.

**Rationale:** Corral Talent's purpose is to be a working reference. A non-working
reference is worse than no reference at all, because it looks authoritative.

**Override path:** No override.

---

### Stack is locked

**Rule:** Corral Talent's stack is React 19 + Vite + TypeScript + Tailwind 4 (UI),
Fastify + Drizzle ORM + Better Auth + Zod (API), Vitest + Playwright (tests), pnpm
workspaces. Downstream forks may diverge; Corral Talent itself does not.

**Protects:** The consistency the reference relies on for its lessons to transfer
cleanly — patterns shown in one part of the codebase are expressible in the same
idioms everywhere else.

**Rationale:** Stack divergence in a reference template fragments the lessons it
teaches. The same patterns must be expressible in the same idioms.

**Override path:** No override within Corral Talent. Forks substitute freely.

---

## Reconstruction guidance

This section exists for anyone doing a from-scratch reimplementation — the "what
must survive" list, independent of how faithfully the rest of the code is copied.

### Must preserve

Each constraint above with "No override" maps to a must-preserve item:

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
- The stack is locked at the Corral Talent level.

### Should question

- **The 64-char SESSION_SECRET floor** — some teams find 32 sufficient. The doubled
  minimum is cheap insurance, but if it produces friction (e.g. operator pushback on
  rotation procedures), the right move may be to drop to 48 with clearer rotation
  guidance, not to weaken validation.
- **Hard remote-only with no local Docker** — this is the most opinionated stance
  in the ideology. For some downstream forks (open-source projects expecting
  community contributors who can't be given remote credentials) the right answer
  is a docker-compose fallback. Corral Talent commits to the harder rule; forks may not.
- **TanStack Query as the sole HTTP seam** — a hand-rolled fetch wrapper can have
  more direct test ergonomics in some scenarios (event dispatch is easier to
  observe than QueryClient defaults). If 401 UX becomes hard to test, revisit.

### Free to change

- Specific Zustand store names and file layout — the discipline is "client state
  only in Zustand," not "named exactly this way."
- Component file structure within `ui/src/components/` — feature folders,
  flat layout, or another scheme is fine as long as theme tokens and React
  Query rules hold.
- Test file naming (`*.test.ts` vs `*.spec.ts`) — pick one and be consistent.
- Specific Drizzle helper patterns (relations API vs query API) — both are
  acceptable; pick per query and document the choice if non-obvious.
- The grace-window duration for MFA enrolment — the existence of the window is
  the constraint; its length is configurable.
- Which S3-compatible provider — the StorageClient seam is the constraint; the
  underlying provider (Minio, R2, S3, B2) is free.

---

## Comparison basis

When two implementations of Corral Talent are compared against this ideology, these
are the dimensions that matter:

- **Boundary enforcement** — does each layer rule (routes/services/db, env
  containment, UI/API separation, single seam per external service) hold without
  exception? Is the enforcement structural (CI test, deny list, generated
  artefact) or human (reviewer attention)? Structural wins.

- **Defence-in-depth coverage** — does every bound that could meaningfully exist
  at two layers exist at two layers? Are the two layers in agreement, or has
  drift opened a gap?

- **Reference fidelity** — does every committed example actually run? Is the
  documentation pointing at code, or does the prose stand alone? A reader who
  copies any example into their own project — does it work?

- **Auth-model separability** — can the RBAC layer and the ABAC layer be reasoned
  about independently? Is there exactly one place where each kind of check
  happens, or has the boundary smeared?

- **Stack and contract legibility** — would a downstream fork that reads
  `architecture.md` and `api-types.ts` (or the OpenAPI spec) be able to
  reimplement the server in another language without losing fidelity?

---

*This document is a companion to `docs/brief.md` (what and why) and
`docs/architecture.md` (how). Together they form the complete ideology record
for Corral Talent.*
