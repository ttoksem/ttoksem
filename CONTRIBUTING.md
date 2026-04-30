# Contributing

Thanks for your interest in ttoksem. This is a small, opinionated
workspace — please skim the conventions below before sending a change.

## Prerequisites

- Node.js 22+
- pnpm — pinned to the version in `packageManager` (`package.json`).
  Running any `pnpm` command in the repo will use it via Corepack.
- macOS / Linux. Windows works through WSL but isn't part of CI.

The local SQLite adapter (`better-sqlite3`) builds a native module on
install; if `pnpm install` fails on first run, install Xcode CLT or
the equivalent build toolchain and retry.

## Getting set up

```bash
git clone https://github.com/ttoksem/ttoksem.git
cd ttoksem
pnpm install
pnpm -r build       # compile every package once (TypeScript)
pnpm -r test        # vitest across the workspace
```

To exercise the local dashboard end-to-end:

```bash
pnpm cli workspace init --key dev --name "dev workspace"
pnpm cli auth key create --scope dashboard:read --scope api:write
pnpm cli dashboard serve --workspace dev --port 4317
# open http://127.0.0.1:4317/?workspace=dev and paste the token
```

The local SQLite database lives at `.ttoksem/ttoksem.db` next to the
repo root. Override it with `TTOKSEM_DB=/abs/path/to.db` when you want
a throwaway scratch DB (e.g. for reproducing a bug).

## Workspace layout

```
packages/
  schema/          zod records and shared types
  storage/         storage interface (LedgerStore)
  storage-sqlite/  better-sqlite3 adapter
  storage-d1/      Cloudflare D1 adapter
  providers/       Anthropic / OpenAI / Codex / Claude observers + summarizers
  core/            LedgerService — the business-logic boundary
  http/            Hono app, dashboard HTML, OpenAPI routes
  cli/             commander-based local CLI
apps/
  server/          Node server entrypoint (uses storage-sqlite)
  worker/          Cloudflare Worker entrypoint (uses storage-d1)
docs/              design notes, examples, worker deployment guide
```

Each package has its own `dev`, `build`, `lint`, `test` scripts. The
root scripts iterate with `pnpm -r`.

## Conventions

- TypeScript strict; no implicit `any`. Prefer narrow types over
  `unknown`-then-cast.
- Keep packages small and focused. Cross-package imports go through
  the package's public entrypoint, not deep paths.
- Storage adapters implement `LedgerStore` from `@ttoksem/storage`
  identically — if you add a method, add it in all three (interface +
  sqlite + d1) and update the in-memory test mock in
  `packages/core/src/ledger-service.test.ts`.
- HTTP routes are declared via `createRoute` (zod-openapi) so the
  generated OpenAPI surface stays accurate.
- Don't introduce mocks for the database in tests; the SQLite adapter
  is fast enough to use directly.
- Avoid speculative abstractions. Three similar lines is better than a
  premature helper.

## Commits and PRs

- Conventional Commits style: `feat(scope): …`, `fix(scope): …`,
  `refactor(scope): …`, etc. Scopes typically match a package or a
  surface (`overview`, `inbox`, `pricing`, `auth`, `worker`, …).
- Commit messages explain *why*, not just *what*. The diff already
  shows what.
- Run `pnpm -r test` and `pnpm -r build` before opening a PR.
- One topic per PR. If you find an unrelated bug while doing a feature,
  open a separate PR for it.

## Versioning and releases

The repo uses a single workspace version (every package ships at the
same number). Releases are cut manually:

1. Update `version` in every `package.json` (root + `packages/*` + `apps/*`).
2. Add a section to `CHANGELOG.md` summarizing the release by area.
3. Tag `vX.Y.Z` and push the tag.

Until further notice, breaking changes are allowed in minor bumps —
the project is pre-1.0.

## Reporting issues

- Bug reports: minimal repro, observed vs expected, the relevant log
  excerpt (`/tmp/ttoksem-dash.log` if dashboard, otherwise the CLI
  output). `TTOKSEM_HTTP_DEBUG=1` makes 4xx/5xx self-explanatory.
- Feature requests: describe the workflow you're trying to support and
  what's awkward today, not just the proposed solution.
