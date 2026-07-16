# CLAUDE.md — asp

> Stack: React 19 + Vite + TypeScript + TailwindCSS (SPA); Fastify + Drizzle ORM + Better Auth (API); Vitest + Playwright; pnpm monorepo.

## Read before any task

1. `docs/brief.md` — what and why
2. `docs/architecture.md` — how and architectural decisions

These two documents should be sufficient for any model or toolchain to cold-start this project.

## Working in this repo

Build gate before considering any change complete:

```bash
pnpm typecheck && pnpm test
```

Keep documentation current: if a change touches code that a doc under `docs/` (or `README.md`)
describes, update that doc in the same change. Stale documentation actively misleads whoever
reads it next.
