# Worker D1 Deployment

ttoksem can run the same Hono dashboard/API routes in a Cloudflare Worker by wiring `apps/worker` to a D1 binding.

The Worker expects these bindings or variables:

```text
TTOKSEM_DB             D1 database binding
TTOKSEM_WORKSPACE_KEY  default workspace key, optional, defaults to ttoksem-dev
TTOKSEM_AUTH_MODE      access-key or none, optional, defaults to access-key
```

The D1 adapter creates the current schema on startup through `LedgerService.init()`. For production deployment, run migrations deliberately in the deploy pipeline rather than relying only on request-time initialization.

Example `wrangler.toml` shape:

```toml
name = "ttoksem"
main = "apps/worker/dist/index.js"
compatibility_date = "2026-04-28"

[vars]
TTOKSEM_WORKSPACE_KEY = "ttoksem-dev"
TTOKSEM_AUTH_MODE = "access-key"

[[d1_databases]]
binding = "TTOKSEM_DB"
database_name = "ttoksem"
database_id = "<cloudflare-d1-database-id>"
```

Local development still defaults to SQLite through the CLI and `apps/server`. The Worker path is for deployments that need an HTTP surface backed by D1, not a replacement for the local-first workflow.
