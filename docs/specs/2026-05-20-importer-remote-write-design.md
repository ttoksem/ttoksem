# Spec — Importer Remote-Write (sub-project 3 of 3)

Date: 2026-05-20
Status: Approved (autonomous — designed under a delegated "proceed" directive). Pending implementation plan.

## Goal

Make the Claude and Codex session importers (`usage import-claude-sessions`,
`usage import-codex-sessions`) and the `ttoksem hook run` autocapture command
work in the CLI's **remote mode** — when `TTOKSEM_HTTP_URL` is set — so usage
events reach a self-hosted Worker's D1 instead of only a local SQLite DB. Today
these commands hard-error in remote mode, so a self-hosted Worker (sub-project
2) cannot actually receive autocapture data.

After this: `ttoksem hook run` (the Claude Code Stop hook) and the importers run
against a remote ttoksem Worker, completing the multi-environment story —
several machines' autocapture feeding one shared ledger.

## Why

- Sub-project 1 made the CLI locally installable; sub-project 2 made the Worker
  self-hostable. But the autocapture hook runs `import-claude-sessions`, and
  that command — like `import-codex-sessions` and `hook run` — calls
  `requireLocalLedger()`, which throws in remote mode. So a self-hosted Worker
  serves the dashboard / API but never receives autocaptured session usage.
- The block is artificial. The importers (`importClaudeSessions`,
  `importCodexSessions`) are typed `service: LocalLedger`, but the only ledger
  method either one calls is `recordUsage` — a method on the base, remote-safe
  `Ledger` tier that `HttpLedgerClient` already fully implements
  (`POST /api/usage/events`). `hook run` additionally calls `getLastImportedAt`,
  also a `Ledger`-tier method with a working HTTP route. JSONL parsing is local
  (the session files live on each machine — correct); only the *write* needs to
  reach the remote ledger, and the `Ledger` interface already supports it.

This is sub-project 3 of 3 — the last piece of the "installable / usable by
other users across environments" effort.

## Scope

### In scope

1. **Narrow the importer signatures.** `importClaudeSessions` and
   `importCodexSessions` take `service: LocalLedger`; change to `service: Ledger`.
   Both already call only `service.recordUsage(...)`, so they typecheck
   unchanged against the narrower interface.
2. **Un-gate the three command handlers.** `usage import-claude-sessions`,
   `usage import-codex-sessions`, and `hook run` currently do
   `const service = requireLocalLedger(handle)` — which throws in remote mode.
   Change them to use `handle.ledger` (typed `Ledger`), so they run against the
   remote `HttpLedgerClient` when `TTOKSEM_HTTP_URL` is set and the local
   `LedgerService` otherwise. `makeLedgerLocal()` already routes to the right
   one — the factory needs no change.
3. **Update `docs/REMOTE-MODE.md`.** Move `usage import-claude-sessions` and
   `usage import-codex-sessions` from "What doesn't" to "What works"; note that
   `hook run` works in remote mode (autocapture can feed a remote Worker).
4. **Tests** — remote-mode coverage for the importers and `hook run`; see Tests.

### Out of scope (explicit)

- `usage codex-turn`, `usage claude-turn`, `usage openai-response`,
  `usage anthropic-response` — these also read local files and stay
  remote-disabled. They are manual / secondary logging commands, not the
  autocapture path; un-gating them needs separate per-command verification that
  they too touch only `Ledger`-tier methods. A possible follow-up.
- `apps/worker` / Worker-side changes — none needed. `HttpLedgerClient`'s
  `recordUsage` / `getLastImportedAt` hit `POST /api/usage/events` and the
  last-import route, which the Worker's Hono app already serves (the same routes
  `usage add` / `usage last-import` use — and those already work in remote mode).
- Importer per-event error resilience — if a `recordUsage` HTTP call fails
  mid-import, the importer's *existing* error handling applies. Adding per-event
  retry/backoff is out of scope; the incremental `--since` watermark plus the
  `claude-session:`/`codex-session:` idempotency keys mean a re-run recovers.
- `requireLocalLedger` itself stays — genuinely local commands (`workspace
  init`, `doctor`, `auth key *`, pricing writes, `dashboard serve`) keep it.

## Architecture

A CLI-only change. No Worker, core, storage, schema, or HTTP-route change.

```
ledger tiers (packages/core/src/ledger.ts):
  Ledger  ⊂  AdminLedger  ⊂  LocalLedger
  recordUsage, getLastImportedAt are on Ledger — the remote-safe base tier.

  HttpLedgerClient implements Ledger       (remote — POST /api/usage/events)
  LedgerService    implements LocalLedger   (local SQLite; LocalLedger is-a Ledger)

before:  import cmd / hook run -> makeLedgerLocal() -> requireLocalLedger(handle)
                                                       └─ throws if TTOKSEM_HTTP_URL set

after:   import cmd / hook run -> makeLedgerLocal() -> handle.ledger : Ledger
                                   ├─ TTOKSEM_HTTP_URL set -> HttpLedgerClient -> Worker -> D1
                                   └─ unset               -> LedgerService    -> local SQLite
```

### The change

- `importClaudeSessions(service: Ledger, options)` and
  `importCodexSessions(service: Ledger, options)` — parameter type narrowed from
  `LocalLedger`. The function bodies are unchanged (they call only `recordUsage`).
- The `.action()` handlers of `usage import-claude-sessions`,
  `usage import-codex-sessions`, and `hook run` — replace
  `const service = requireLocalLedger(handle)` with `const service = handle.ledger`.
  Everything else (JSONL parsing, `--since`, the import preview, the
  `try/finally` `handle.close()`) is unchanged. `hook run`'s `getLastImportedAt`
  call already targets a `Ledger` method.

JSONL parsing stays local — the importer reads `~/.claude/projects/**/*.jsonl`
on the machine it runs on. Only the resulting usage-event writes go to the
remote ledger. Workspaces are addressed by `--workspace <key>` (a string key),
which `HttpLedgerClient` accepts (it rejects only `rootPath` resolvers).

## Error handling & edge cases

- Remote mode with no token / a bad token / the server down → `HttpLedgerClient`
  throws `HttpLedgerError` (401 / 403 / status 0, etc.); the command surfaces it.
  This is the same failure surface every other remote-mode command already has.
- A self-hosted Worker whose D1 has no such workspace → `recordUsage` returns a
  4xx; surfaced to the user.
- Local mode is completely unchanged — when `TTOKSEM_HTTP_URL` is unset,
  `handle.ledger` is the `LedgerService` (a `LocalLedger`, which is-a `Ledger`),
  so the importers and `hook run` behave exactly as before.

## Tests

- **Remote-mode importer test** — run `usage import-claude-sessions` (and
  `import-codex-sessions`) with `TTOKSEM_HTTP_URL` pointed at an in-process Hono
  server backed by a real `LedgerService` (the pattern the existing CLI
  remote-mode e2e test and `@ttoksem/ledger-http`'s tests already use). Assert
  the parsed session usage lands in the server-side ledger.
- **Remote-mode `hook run` test** — `hook run` against the same in-process
  server; assert the project's session usage is imported remotely.
- **Local mode unchanged** — the pre-existing importer / `hook run` tests keep
  passing (they exercise the local path).
- **Type-level** — narrowing to `Ledger` keeps `tsc` green; the importers
  compile against the narrower interface.

## Backward compatibility

- Local mode (`TTOKSEM_HTTP_URL` unset) is unchanged.
- No interface, schema, HTTP-route, or Worker change. `Ledger` /
  `HttpLedgerClient` already expose everything needed.
- `requireLocalLedger` and every genuinely-local command are untouched.

## Documentation

- `docs/REMOTE-MODE.md` — the two importers move to "What works"; `hook run`
  noted as remote-capable.

## Open questions

To resolve during implementation; none block the design:

- **Importer per-event error handling.** Confirm what `importClaudeSessions` /
  `importCodexSessions` do when `recordUsage` throws mid-loop (catch-and-count as
  an error, or abort). Either is acceptable for v1 — `--since` + idempotency-key
  dedup make a re-run safe — but note the actual behavior in `REMOTE-MODE.md` if
  it aborts on the first error.

## Follow-on work

- Optionally un-gate `usage codex-turn` / `claude-turn` / `openai-response` /
  `anthropic-response` in remote mode (same mechanism, after verifying each
  touches only `Ledger`-tier methods).
- With sub-project 3 done, the three-part "installable / self-hostable /
  autocapture-to-remote" effort is complete. Remaining items are the spawned
  follow-up chips: the importer `imported`/`skipped` counter bug, publish-
  manifest hardening, and `worker key list` column parity.
