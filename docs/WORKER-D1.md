# Worker D1 Deployment

ttoksem can run the same Hono dashboard/API routes in a Cloudflare Worker by wiring `apps/worker` to a D1 binding.

The Worker expects these bindings or variables:

```text
TTOKSEM_DB             D1 database binding
TTOKSEM_WORKSPACE_KEY  default workspace key, optional, defaults to ttoksem-dev
TTOKSEM_AUTH_MODE      access-key or none, optional, defaults to access-key
```

The D1 adapter creates the current schema on startup through `LedgerService.init()`. For production deployment, run migrations deliberately in the deploy pipeline rather than relying only on request-time initialization.

The deploy config is committed at [`apps/worker/wrangler.jsonc`](../apps/worker/wrangler.jsonc). To deploy:

1. `wrangler d1 create ttoksem` — creates the D1 database and prints its id.
2. Paste that id into `apps/worker/wrangler.jsonc` (`d1_databases[0].database_id`).
3. `pnpm --filter @ttoksem/worker deploy` — builds and uploads the Worker.

Or use the one-click **Deploy to Cloudflare** button in the README, which provisions the Worker and D1 in a guided browser flow.

Local development still defaults to SQLite through the CLI and `apps/server`. The Worker path is for deployments that need an HTTP surface backed by D1, not a replacement for the local-first workflow.

## Access keys on the deployed D1

The `ttoksem worker key` commands manage `access_keys` on a deployed D1 by
running SQL through `wrangler d1 execute --remote`. They need `wrangler`
installed and authenticated (`wrangler login`).

Create a key (the token is printed once — save it):

    ttoksem worker key create --d1 ttoksem --name dashboard \
      --scope dashboard:read --scope api:write

List keys (no token secrets are shown):

    ttoksem worker key list --d1 ttoksem

Revoke a key:

    ttoksem worker key revoke --d1 ttoksem --id key_xxxxxxxxxxxx

`--d1 <database>` is the D1 `database_name` from `wrangler.jsonc`. There is no
token-issuance HTTP route on the Worker on purpose — a credential-minting
endpoint would be an attack target — so keys are issued operator-side via
`wrangler`.

### Scopes worth knowing

- `dashboard:read` — required for everything the dashboard renders (`/`, `/inbox`, `/tasks/...`, the readonly `/api/*` endpoints)
- `api:write` — required for state-changing endpoints (task create/update/close, usage record/move/repricing, inbox assign/accept/reject, workspace create)
- `*` — wildcard; matches any required scope

A key issued for human dashboard use should normally carry both `dashboard:read` and `api:write` so the inbox assign/accept buttons stay enabled. A key issued for an automated importer should carry just `api:write`.
