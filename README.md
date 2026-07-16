# Corral Talent

A locked-stack, opinionated SPA template demonstrating disciplined defaults for
single-tenant multi-user web applications. The working reference implementation
is a skills-database for entry-level applicants.

## Who this is for

Developers building single-page applications that need:
- Multi-user auth with mandatory TOTP MFA
- Role-based access control (RBAC) and content-based access (ABAC)
- A modern, strongly-typed data layer
- Reference implementations of common patterns

## Key features

The reference implementation includes:
- **Applicant surfaces**: portfolio management with experience logging, milestone
  tracking, and resume/headshot uploads
- **Mentor workspace**: talent review, experience verification, and grant-based
  access to applicant data
- **Admin dashboard**: user and grant management, configuration controls
- **Security**: mandatory TOTP MFA, RBAC/ABAC access control, audit logging
- **Developer experience**: typed OpenAPI client (Zod + Better Auth), strict schema
  validation, comprehensive tests

## Stack

React 19 + Vite + TypeScript + Tailwind CSS (UI); Fastify + Drizzle + Better Auth
+ Zod (API); Vitest + Playwright (tests); pnpm workspaces.

## Quick start

1. `git clone git@github.com:nullvalues/corral.git && cd corral`
2. `pnpm install`
3. Create `.env.local` from `.env.example` and configure:
   - `DATABASE_URL`: PostgreSQL 15+ connection string (local or remote)
   - `BETTER_AUTH_*`: auth provider credentials
   - Other secrets as documented
4. `pnpm --filter @asp/api migrate:run` — apply migrations
5. `pnpm seed:uat` — provision test accounts (requires API on `:6050`)
6. `pnpm dev` — API on `:6050`, UI on `:6051`

**Port note**: Corral Talent pins all dev servers to **6050–6059** for consistency.

## Documentation

- **[Quickstart & concepts](docs/index.md)** — overview and getting started
- **[Development guide](docs/development.md)** — day-to-day workflows
- **[Operations guide](docs/operations.md)** — deployment, monitoring, scaling
- **[Architecture decisions](docs/architecture.md)** — design rationale
- **[Ideology](docs/ideology.md)** — project convictions and constraints
- **[HTML reference docs](docs/site/index.html)** — generated API docs

## Design philosophy

The reference implementation is intentionally designed to be reconstructible from
its documentation:
- **`docs/ideology.md`** — convictions, value hierarchy, and accepted constraints
- **`docs/architecture.md`** — how those constraints are implemented, and why

See these files to understand the design philosophy and reasoning behind the
codebase's rules.

## License

MIT — see [`LICENSE`](LICENSE).
