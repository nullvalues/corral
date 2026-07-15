# Contributing to asp

asp is a locked-stack reference template. Contributions should fix bugs, improve docs, or enhance features within the stack we've chosen — not replace it.

## Setup

See [docs/development.md](docs/development.md) for prerequisites, installation, and dev environment setup.

## Build gate

All pull requests must pass:

```bash
pnpm typecheck && pnpm test
```

No exceptions. A PR that fails the build gate is not ready for review.

## PR expectations

- **Scope:** one story per PR. Diffs should be tight and story-scoped. Large refactors split into separate PRs.
- **Title:** reference the story ID if it exists (e.g. `feat(story-UI-109): resume upload UI`).
- **Linked issue:** reference the tracking issue (e.g. `Closes #N`).

## Locked stack

This project uses React 19, Vite, TypeScript, TailwindCSS (SPA); Fastify, Drizzle, Better Auth (API); Vitest, Playwright. **Stack-replacement PRs are out of scope by design.** Our goal is to demonstrate locked-stack discipline, not framework flexibility.

Want to fork asp for a different stack? That's the point. Fork, adapt, and go.
