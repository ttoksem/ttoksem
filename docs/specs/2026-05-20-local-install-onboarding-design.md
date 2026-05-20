# Spec — Local Install Onboarding (sub-project 1 of 3)

Date: 2026-05-20
Status: Approved in brainstorming. Pending spec review and implementation plan.

## Goal

Make ttoksem installable and usable by a developer who is not a ttoksem
contributor. Today the only way to run ttoksem is to clone the monorepo,
`pnpm install`, and build — a contributor workflow. After this work, a new user
installs a published CLI and runs one setup command to get a working local
ledger that captures their AI usage automatically.

Target experience: `npm install -g ttoksem` → `ttoksem init` → usage is being
captured.

## Why

- ttoksem is intended for adoption by other users, not just the maintainer's
  personal use. A tool only its author can install does not meet that goal.
- `@ttoksem/cli` is a workspace-internal package: its dependencies are all
  `workspace:*`, so it cannot be `npm install`-ed outside the monorepo.
- Its local storage adapter (`packages/storage-sqlite`) depends on
  `better-sqlite3`, a native module. Native modules are the most common cause of
  `npm install` failures (compiler toolchain, prebuilt-binary gaps).
- The README is a feature/policy reference with no user-facing quick start.

This is sub-project 1 of a 3-part effort to make ttoksem usable by other users.
Sub-projects 2 (Worker self-host onboarding) and 3 (importer remote-write gap)
are out of scope here — see "Follow-on work".

## Scope

### In scope

1. **CLI distribution.** Bundle `@ttoksem/cli` into a single self-contained
   artifact with esbuild so the published package carries no `workspace:*`
   dependencies. Publish to npm as `ttoksem` (unscoped); fall back to a scoped
   name if `ttoksem` is unavailable.
2. **Native-dependency removal.** Replace the `better-sqlite3` driver in
   `packages/storage-sqlite` with a non-native SQLite backend so `npm install`
   never requires a compiler or a prebuilt binary. Primary choice: Node's
   built-in `node:sqlite`. Fallback: a pure-WASM SQLite (`node-sqlite3-wasm`) —
   see Open questions.
3. **`ttoksem init` command.** A guided onboarding command: create (or detect
   and reuse) the local workspace and DB, detect whether the current directory
   is a Claude Code project, and offer — with explicit consent — to install the
   autocapture hook.
4. **Generalized autocapture hook.** Move the autocapture logic currently in the
   bespoke workspace script `ttoksem-autocapture.sh` into a parameterized
   `ttoksem` subcommand. `ttoksem init` registers a Claude Code Stop hook that
   invokes it.
5. **README quick start.** Add a "Quick Start" section at the top of the README:
   install, `ttoksem init`, and how to view captured usage.
6. **Tests** — see the Tests section.

### Out of scope (explicit)

- Worker / D1 self-host onboarding (sub-project 2): `wrangler.toml`, the "Deploy
  to Cloudflare" button, access-key issuance. The local CLI works entirely
  without Cloudflare.
- The importer remote-write gap (sub-project 3): making `import-claude-sessions`
  work in remote mode.
- Standalone single-file executables, Homebrew, or other distribution channels.
  The target audience (Claude Code / Codex users) already has Node; npm is
  sufficient.
- Codex-side autocapture automation. The Stop hook is a Claude Code mechanism;
  Codex users rely on manual or scheduled `import-codex-sessions`.
- Non-developer / no-Node audiences.

## Architecture

The change is confined to the `ttoksem/` repo. No new packages; existing
packages change.

```
[install]
  npm install -g ttoksem
      -> published package = esbuild bundle of @ttoksem/cli + all deps
      -> zero native dependencies -> no compile step

[first run]
  ttoksem init
      -> workspace + .ttoksem/ttoksem.db   (reuses `workspace init` logic)
      -> detect .claude/ project
      -> [consent] register Stop hook in .claude/settings.json
                   -> hook calls `ttoksem <hook-subcommand>`

[ongoing]
  Claude Code Stop event -> ttoksem <hook-subcommand>
                         -> import session usage -> local DB
```

### 1. CLI packaging & native-dependency removal

- `packages/cli` gains an esbuild bundle step. Build output: a single
  `dist/index.js` with a Node shebang. All `@ttoksem/*` workspace code and
  third-party runtime deps (e.g. `commander`) are inlined into the bundle, so
  the published `package.json` has no `dependencies` — dependency resolution is
  eliminated as a failure mode. `bin` stays `ttoksem`.
- `packages/storage-sqlite`: swap the `better-sqlite3` driver for `node:sqlite`.
  Both expose a synchronous prepared-statement API, which matches the adapter's
  existing explicit-SQL style; the change is mechanical per call site. The
  adapter's public interface (`LedgerStore`) does not change, so `@ttoksem/core`,
  the CLI, and `apps/server` are unaffected.
- The repo gains a Node-version floor (`engines.node`) reflecting the
  `node:sqlite` requirement.
- `packages/storage-d1` is untouched — it already uses the D1 driver, not
  `better-sqlite3`.

### 2. `ttoksem init` & hook installation

- New top-level command `ttoksem init`. It is the friendly front door; the
  existing lower-level `workspace init` remains and is reused internally.
- Flow:
  1. Resolve/create the workspace and `.ttoksem/ttoksem.db`. If a DB already
     exists, detect and reuse it rather than overwrite.
  2. Detect a Claude Code project (presence of `.claude/`).
  3. If found, prompt for consent to install the autocapture hook. On yes, merge
     a Stop hook entry into `.claude/settings.json`, preserving any existing
     hooks. On no, print manual instructions and exit cleanly.
  4. Print next steps (how to view captured usage).
- Hook mechanism: the autocapture logic currently in `ttoksem-autocapture.sh`
  (active-task lookup, incremental `--since` import, project scoping) moves into
  a parameterized `ttoksem` subcommand. The Stop hook entry calls that
  subcommand. No standalone shell script is shipped, so the hook always runs the
  installed CLI version.

### 3. README quick start

A new "Quick Start" section is prepended to the README: the install command,
`ttoksem init`, and a pointer to `ttoksem dashboard serve` / reports to see
captured usage. Existing feature/policy reference content moves below it.

## Error handling & edge cases

- **Existing DB**: `ttoksem init` detects an existing `.ttoksem/ttoksem.db` and
  reuses it; it never overwrites.
- **No Claude Code project**: if `.claude/` is absent, `init` still sets up the
  workspace, skips the hook step, and explains why.
- **Existing Stop hook**: a `.claude/settings.json` that already contains hooks
  is merged into, not replaced.
- **Hook already installed**: a previously installed ttoksem hook is detected
  and skipped or updated, not duplicated.
- **Consent declined**: `init` exits 0 after printing manual hook instructions.
- **Node too old**: if the runtime predates the `node:sqlite` requirement, fail
  with a clear message naming the required version — at install time via
  `engines`, and defensively at first run.

## Tests

- **Storage driver swap**: the existing `packages/storage-sqlite` suite
  (`index.test.ts`, `migration-0008.test.ts`) must pass unchanged after the
  `node:sqlite` swap. This is the safety net for the only substantial code
  change.
- **`ttoksem init` workflow test**: creates a workspace in a temp dir, exercises
  the consent flow (accept and decline), and asserts the DB and — on accept —
  the `.claude/settings.json` hook entry.
- **settings.json merge**: unit tests that merging the Stop hook preserves
  pre-existing hooks and is idempotent (re-running does not duplicate).
- **Bundle smoke test**: the built single-file bundle runs (`ttoksem --help`)
  with no `@ttoksem/*` resolution and no native module load.

## Backward compatibility

- The `LedgerStore` interface is unchanged; the storage swap is internal to
  `storage-sqlite`.
- `workspace init` and all existing CLI commands keep working; `ttoksem init` is
  additive.
- Existing contributors' `pnpm`-based workflow is unaffected; bundling and
  publishing is a new build target, not a replacement.
- The maintainer's existing bespoke `ttoksem-autocapture.sh` setup is not
  modified by this work. Migrating it to the new subcommand is a later nicety,
  not in scope.

## Documentation

- README: new "Quick Start" section (scope item 5).
- A short note in `MIGRATION.md` if the Node-version floor affects existing
  contributors.

## Open questions

To resolve during implementation; none block the design:

- **`node:sqlite` maturity.** Confirm its stability status and the exact
  Node-version floor. If it is still flagged experimental in a way that hurts
  the target audience, fall back to a pure-WASM SQLite (`node-sqlite3-wasm`):
  one bundleable dependency, no native compile, no Node-version floor.
- **npm name.** Confirm `ttoksem` is available on npm; if not, publish scoped
  and adjust the documented install command.
- **Hook subcommand name.** The exact name of the autocapture subcommand
  (`ttoksem hook run`, `ttoksem capture`, …) is settled in the implementation
  plan.

## Follow-on work (separate specs)

- **Sub-project 2 — Worker self-host onboarding**: `wrangler.toml`, a "Deploy to
  Cloudflare" button, and a real access-key issuance path (replacing the
  raw-SQL step documented in `docs/WORKER-D1.md`).
- **Sub-project 3 — importer remote-write**: un-gate `import-claude-sessions` /
  `import-codex-sessions` in remote mode so the autocapture hook can feed a
  self-hosted Worker (parse JSONL locally, write via the HTTP `Ledger`).
