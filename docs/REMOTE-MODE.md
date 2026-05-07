# Remote mode (Plan 4)

ttoksem CLI can talk to a running ttoksem server instead of a local
SQLite DB. Use this for multi-machine setups, multi-agent
configurations, or when several Claude Code sessions on the same host
need to share one ledger.

## Enable

```bash
export TTOKSEM_HTTP_URL=https://ledger.example.com
export TTOKSEM_HTTP_TOKEN=ttoksem_live_…   # bearer token; required when the server enforces auth
```

The CLI auto-detects `TTOKSEM_HTTP_URL`. Unset both vars to revert to
local mode. The token may be omitted when the server runs
`auth: { mode: "none" }` (e.g., a private intranet deployment).

## What works

Every Ledger-tier subcommand (full list verified against
`packages/cli/src/index.ts` after Plan 4 Task 7):

- **Workspaces:** `workspace list`
- **Tasks:** `task start`, `task archive`, `task close` (deprecated alias),
  `task list`, `task active` (deprecated), `task stats`, `task update`
- **Usage:** `usage add`, `usage move`, `usage last-import`
- **Inbox:** `inbox list`, `inbox show`, `inbox assign`,
  `inbox accept`, `inbox assign-event`
- **Dashboard:** `dashboard overview`
- **Reports:** `report today`, `report task`
- **Pricing reads:** `pricing list`, `pricing snapshot list`

## What doesn't (and why)

The following subcommands need admin or filesystem capabilities and
hard-error in remote mode with the message:

> Error: This subcommand requires a local DB and is not available in remote
> mode. Unset TTOKSEM_HTTP_URL or run the command on the server host.

| Subcommand | Reason |
|---|---|
| `doctor` | Diagnoses a local DB; meaningless against a remote server |
| `workspace init` | Creates `.ttoksem/ttoksem.db` on the local filesystem |
| `workspace current` | Resolves a local cwd to a workspace |
| `auth key create` / `list` / `revoke` | Admin tier; managed server-side |
| `pricing snapshot upsert`, `pricing import-litellm`, `pricing upsert` | Admin tier (writes pricing policy) |
| `pricing reprice`, `pricing migrate-events` | Admin tier (recomputes pricing) |
| `usage codex-turn`, `usage claude-turn` | Read local files |
| `usage import-codex-sessions`, `usage import-claude-sessions` | Read local JSONL session logs |
| `usage openai-response`, `usage anthropic-response` | Read local response JSON |
| `dashboard serve` | Serves the dashboard from the local DB |

If you need any of these in a remote setup, run them on the server
host (where the local DB lives).

## Token scopes

The server uses `dashboard:read` for read routes and `api:write` for
mutations. Generate a token with both scopes for full Ledger access:

```bash
# on the server host:
pnpm cli auth key create \
  --workspace-scope <workspace-key> \
  --name "remote-cli" \
  --scope dashboard:read \
  --scope api:write
```

The output includes the token to set as `TTOKSEM_HTTP_TOKEN`. Tokens
are workspace-scoped — list a workspace per token.

## Errors

The client throws `HttpLedgerError` on non-2xx responses. The error
carries `status` and the parsed response body when available:

| Status | Meaning |
|---|---|
| `0` | Network error or invalid response (server down, DNS failure, non-JSON body) |
| `401` | Missing or invalid token |
| `403` | Token lacks required scopes |
| `404` | Resource not found. Note: `getPricingSourceSnapshot` translates 404 to `null` instead of throwing. |
| `410` | Endpoint removed (e.g., `task active` after Sunset 2026-11-07) |
| `5xx` | Server error |

## Limitations

- `verifyAccessKey` has no public route. The server uses it
  internally during authorization; the client method exists for type
  conformance with `Ledger` and throws if called directly.
- Streaming endpoints are not supported (none exist on `Ledger` today).
- TLS/mTLS configuration uses Node's defaults. Set `NODE_EXTRA_CA_CERTS`
  if you need a custom CA bundle.
- No client-side retry / backoff. Failed fetches throw immediately;
  shell scripts can implement retry around the CLI invocation.
