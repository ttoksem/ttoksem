# Architecture

## Why This Is A Workspace

ttoksem is not shaped as one package with one `src/` tree because the product is expected to have multiple entrypoints over the same ledger behavior:

- CLI for local setup, reports, and debugging
- HTTP API for local servers, Docker, app servers, and Workers
- MCP tools for AI-agent control
- SQLite locally
- Cloudflare D1 later

Those entrypoints should not define different product semantics. They should call the same core service model.

The workspace split makes that boundary visible from the first implementation slice.

## Package Roles

```text
packages/schema
  Zod schemas and shared TypeScript types.
  This is the contract layer.

packages/core
  Ledger behavior: workspace resolution, task lifecycle, usage ingest, reports.
  This package should stay runtime-neutral.

packages/storage
  Storage interfaces only.
  Core depends on this contract, not on SQLite or D1 directly.

packages/storage-sqlite
  Local SQLite implementation using explicit SQL.
  Node-specific and native-driver code belongs here.

packages/http
  Hono routes for local HTTP surfaces.
  Depends on core behavior and accepts injected services.

packages/cli
  Node CLI entrypoint.
  Wires core plus the SQLite adapter for local use.

apps/server
  Local Node server entrypoint.
  Wires Hono routes plus the SQLite adapter for dashboard use.
```

## Dependency Direction

The intended direction is:

```text
schema
storage -> schema
core -> schema + storage
storage-sqlite -> schema + storage
http -> core
server -> core + http + storage-sqlite
cli -> core + server + storage-sqlite
```

The important rule is that `core` must not import from `cli`, `storage-sqlite`, Node filesystem APIs, or native SQLite drivers.

That lets the same core behavior later run behind HTTP, MCP, or a Cloudflare Worker-compatible adapter.

## Auth Boundary

ttoksem uses database access keys for dashboard/API access. This is a transport guard, not a user model.

The core service owns access-key records, scope checks, optional workspace restrictions, and last-used updates. It does not generate or hash token secrets. Node-specific token generation and SHA-256 hashing live in the CLI/server boundary. The HTTP package accepts an injected verifier so it does not need to know whether the backing runtime is local Node, Worker, SQLite, or D1.

This keeps the ledger model small while still making dashboard/API exposure explicit.

## Is This Libraryization?

Partly, but not primarily.

The goal is not to publish five public npm libraries at the start. The goal is to prevent accidental coupling while the project is still small enough to keep the boundary simple.

In a single-package version, the same idea would look like this:

```text
src/schema
src/core
src/storage
src/cli
```

The workspace version makes those folders enforceable packages, so imports cross boundaries explicitly.

## Execution Model

Development commands run from the repo root:

```bash
pnpm install
pnpm build
pnpm test
pnpm cli doctor
```

The CLI package is the executable package. The other packages are internal workspace dependencies.

For local use, there is no separate deployment step:

```bash
pnpm cli workspace init --key ttoksem --root .
pnpm cli task start first-task --workspace ttoksem
pnpm cli report today --workspace ttoksem
pnpm cli dashboard serve --workspace ttoksem --port 4317
```

## Deployment Options

The current structure supports several later deployment paths:

- Local repo tool: clone the repo and run `pnpm cli ...`
- npm CLI: publish or bundle `packages/cli`
- Docker: install workspace dependencies, build, then run a CLI or server entrypoint
- Single binary-like bundle: bundle the CLI with tsup/esbuild
- Worker app: add a D1 adapter and Worker entrypoint without importing Node-specific packages into core

SQLite currently uses `better-sqlite3`, which is a native dependency. Fresh installs must allow its install/build script. The workspace config already lists it under `onlyBuiltDependencies`.

## Tradeoff

The benefit is clearer product boundaries:

- transports do not redefine ledger semantics
- Node-only code stays out of core
- SQLite and D1 can implement the same storage contract
- tests can target the core service and storage adapter separately

The cost is a slightly more complex repo for early development:

- there are several `package.json` files
- build order matters
- imports use internal package names such as `@ttoksem/core`

This is a deliberate tradeoff from the design source. If the package boundaries start slowing down normal feature work more than they help, the same folder structure can be folded back into a single package without changing the domain model.
