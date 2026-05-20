# Spec — Worker Self-Host Onboarding (sub-project 2 of 3)

Date: 2026-05-20
Status: Approved (autonomous — designed under a delegated "proceed through sub-project 2" directive). Pending implementation plan.

## Goal

Make it low-friction for a developer to self-host their own ttoksem Cloudflare
Worker + D1, so they can use ttoksem across multiple environments. Today
`apps/worker` has the code to run on Cloudflare D1 but no deployment
configuration: there is no `wrangler` config anywhere in the repo, no deploy
script, and access keys for a deployed D1 must be created by hand-running raw
SQL through `wrangler d1 execute`.

After this work: a developer can deploy the Worker either with a one-click
"Deploy to Cloudflare" button or with a documented `wrangler deploy`, and can
issue / list / revoke D1 access keys with `ttoksem worker key` commands instead
of raw SQL.

## Why

- Sub-project 1 made the local CLI installable. Sub-project 2 makes the *remote*
  (multi-environment) path self-hostable. Together they let other users adopt
  ttoksem.
- `apps/worker` is complete code (`D1LedgerStore` + `LedgerService` + the Hono
  app) but undeployable as shipped — no `wrangler` config exists.
- `docs/WORKER-D1.md` documents deployment, but the access-key step is a raw-SQL
  ritual (a Node one-liner that prints an `INSERT`, hand-piped to
  `wrangler d1 execute`). That is exactly the "developer-grade, not
  user-friendly" friction this effort exists to remove.

This is sub-project 2 of 3. Sub-project 1 (local install) is merged. Sub-project
3 (importer remote-write) is out of scope here — see "Follow-on work".

## Scope

### In scope

1. **`wrangler` deploy configuration for `apps/worker`.** Add
   `apps/worker/wrangler.jsonc` declaring the Worker name, entry,
   `compatibility_date`, the `TTOKSEM_DB` D1 binding, and the
   `TTOKSEM_WORKSPACE_KEY` / `TTOKSEM_AUTH_MODE` vars. Add `wrangler` as a
   devDependency of `apps/worker` and a `deploy` script.
2. **"Deploy to Cloudflare" button.** A button in the README / `WORKER-D1.md`
   that links to Cloudflare's deploy flow for this repo, so a user can provision
   the Worker + D1 in a guided browser flow.
3. **`ttoksem worker key` commands.** New CLI subcommands — `worker key create`,
   `worker key list`, `worker key revoke` — that manage `access_keys` rows in a
   deployed D1 by wrapping `wrangler d1 execute`. Replaces the raw-SQL ritual.
4. **Self-host quick start.** Rewrite `docs/WORKER-D1.md`'s deployment section
   around the committed config, the button, and the `worker key` commands.
5. **Tests** — see the Tests section.

### Out of scope (explicit)

- The importer remote-write gap (sub-project 3): `import-claude-sessions` /
  `import-codex-sessions` are still gated off in remote mode. Self-hosting the
  Worker does not yet make the autocapture hook feed it.
- A token-issuance HTTP route on the Worker. Deliberately omitted — a
  credential-minting endpoint is an attack target (per `WORKER-D1.md`). Key
  issuance stays operator-side, via `wrangler`.
- A full `ttoksem worker setup` orchestrator that runs `wrangler d1 create` +
  `deploy` for the user. The Deploy-to-Cloudflare button is the one-click path;
  the documented `wrangler` steps + `worker key` commands are the CLI path. An
  orchestrator is YAGNI.
- Changes to the Worker's runtime code (`apps/worker/src/index.ts`) or the D1
  adapter — they already work; this sub-project is packaging/onboarding only.
- Multi-region, custom-domain, or observability configuration.

## Architecture

The change touches `apps/worker` (new config), `packages/cli` (new commands),
and docs. No Worker runtime code changes.

```
[deploy — one-click]
  README "Deploy to Cloudflare" button
      -> Cloudflare guided flow: fork repo, provision D1, bind TTOKSEM_DB, deploy

[deploy — CLI]
  wrangler d1 create ttoksem             -> returns database_id
  (paste database_id into apps/worker/wrangler.jsonc)
  pnpm --filter @ttoksem/worker deploy    -> wrangler deploy

[issue a key — replaces raw SQL]
  ttoksem worker key create --d1 <db> --name <n> --scope <s> ...
      -> generate ttok_ token + sha256 hash + prefix
      -> build an INSERT into access_keys (escaped)
      -> wrangler d1 execute <db> --command <sql>
      -> print the token once
```

### 1. `apps/worker/wrangler.jsonc`

A committed `wrangler.jsonc` (Cloudflare's current config format; JSONC so
inline comments can tell the user what to fill in). It declares: `name`, the
entry (`main`), `compatibility_date`, the `d1_databases` binding `TTOKSEM_DB`
with a placeholder `database_id`, and `vars` for `TTOKSEM_WORKSPACE_KEY` /
`TTOKSEM_AUTH_MODE`. `apps/worker` gets `wrangler` as a devDependency and a
`deploy` script; the Worker's workspace dependencies are built before deploy.
The Worker entry uses only Web APIs (Web Crypto), so `nodejs_compat` is not
expected — the implementation verifies this with `wrangler deploy --dry-run`.

### 2. "Deploy to Cloudflare" button

A markdown button in the README (and `WORKER-D1.md`) pointing at Cloudflare's
deploy URL for `github.com/ttoksem/ttoksem`. Because this is a monorepo, the
button/flow must target the `apps/worker` directory; the implementation
confirms the correct deploy-button URL form for a monorepo worker and documents
any prerequisite.

### 3. `ttoksem worker key` commands

A new `worker` command group in the CLI (registered like `auth` / `init`), with
`key create | list | revoke` subcommands. They operate on a **deployed D1** —
not the local SQLite ledger — by shelling out to `wrangler d1 execute`:

- `worker key create --d1 <database> --name <n> --scope <s>... [--workspace-scope <k>...] [--expires-at <iso>]`
  — generates a `ttok_` token, computes its SHA-256 hash and prefix, builds an
  `INSERT INTO access_keys (...)`, runs it via `wrangler d1 execute`, and prints
  the token once.
- `worker key list --d1 <database>` — a `SELECT` of the non-secret columns.
- `worker key revoke --d1 <database> --id <key_id>` — an `UPDATE ... SET revoked_at`.

The token / hash / prefix logic is the same as the local `auth key` path: the
shared helpers (`generateAccessToken`, `hashAccessToken`, `tokenPrefix`,
currently private in `packages/cli/src/auth.ts`) are extracted into a small
reusable module so both `auth key` and `worker key` use one implementation. SQL
is built by a pure, unit-tested function with correct SQLite string escaping;
the `wrangler` invocation is injectable so tests never call the real `wrangler`.
The command fails with a clear message if `wrangler` is not on `PATH`.

The `access_keys` column shape is fixed by `docs/ACCESS-AUTH.md` and the D1
schema: `id, name, token_prefix, token_hash, scopes_json, workspace_keys_json,
created_at, updated_at, expires_at, revoked_at, last_used_at`.

### 4. Self-host quick start

`docs/WORKER-D1.md`'s deployment section is rewritten: the "Example
wrangler.toml shape" block becomes a reference to the committed
`apps/worker/wrangler.jsonc`; the raw-SQL "Issuing access keys" section becomes
the `ttoksem worker key` commands; the Deploy-to-Cloudflare button is shown as
the one-click path.

## Error handling & edge cases

- `wrangler` not installed / not on `PATH` → `worker key` commands fail with a
  clear "install and authenticate wrangler" message, not a raw spawn error.
- `wrangler` not authenticated, or the named D1 database does not exist → the
  underlying `wrangler d1 execute` error is surfaced verbatim.
- User-supplied values (`--name`, `--scope`, `--workspace-scope`) are escaped
  for SQLite string literals so a value containing a quote cannot break or
  inject SQL.
- `worker key create` prints the token exactly once with a "save this, it
  cannot be recovered" warning (mirrors `WORKER-D1.md`).
- `apps/worker/wrangler.jsonc` ships with a placeholder `database_id` and a
  comment telling the user to run `wrangler d1 create` and paste the id; a
  deploy with the placeholder fails fast with a `wrangler` error.

## Tests

- **SQL builder unit tests** — the pure function(s) that build the `access_keys`
  `INSERT` / `SELECT` / revoke `UPDATE`: correct columns, correct value
  placement, and SQLite-escaping of quote-containing inputs.
- **`worker key` command workflow tests** — drive the commands with an injected
  fake `wrangler`-exec that captures the SQL and returns canned output; assert
  `create` generates a well-formed token + the right `INSERT`, `list` parses
  output, `revoke` builds the right `UPDATE`. The real `wrangler` is never
  invoked.
- **Shared token-helper test** — confirm the extracted token / hash / prefix
  helpers behave identically to today; the existing `auth key` tests stay green.
- **`wrangler.jsonc` validity** — `wrangler deploy --dry-run` (in the plan's
  verification) confirms the config parses and declares the `TTOKSEM_DB` binding.

## Backward compatibility

- `apps/worker/src/index.ts` and the D1 adapter are unchanged.
- The local `auth key` commands are unchanged in behavior; only their token
  helpers move into a shared module.
- `wrangler.jsonc` is additive — local development (CLI + `apps/server`) is
  unaffected.
- No HTTP surface changes.

## Documentation

- `docs/WORKER-D1.md` rewritten (scope item 4).
- README: the Deploy-to-Cloudflare button.

## Open questions

To resolve during implementation; none block the design:

- **Deploy-button URL for a monorepo.** Confirm the exact "Deploy to Cloudflare"
  button URL/form that targets `apps/worker` in this monorepo, and any
  prerequisite. If a monorepo worker cannot be button-deployed cleanly, the
  button targets a documented path and the `wrangler deploy` flow is the
  reliable fallback.
- **`compatibility_date` / flags.** Pick a current `compatibility_date`; verify
  `nodejs_compat` is not needed via `wrangler deploy --dry-run`.
- **`wrangler d1 execute` output parsing.** Confirm the output format
  `worker key list` parses (it may need `--json`).

## Follow-on work (separate spec)

- **Sub-project 3 — importer remote-write**: un-gate `import-claude-sessions` /
  `import-codex-sessions` in remote mode so a self-hosted Worker can actually
  receive autocapture data. Until then a self-hosted Worker serves the
  dashboard / API and accepts `usage add`, but the Claude / Codex session
  importers still run local-only.
