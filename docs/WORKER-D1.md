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

## Issuing access keys against D1

The `pnpm cli auth key create` command writes to local SQLite only — it does not know about D1. There is also no token-issuance HTTP route in the Worker on purpose (a write endpoint that mints credentials would be an obvious attack target). For the moment that means **D1 access keys are inserted directly via SQL**.

The shape mirrors the `access_keys` table managed by `LedgerService.init()`. The Worker validates a presented token by computing `sha256(token)` and looking the row up by `token_hash`, so the row needs:

- `id`         — any unique string (the local CLI uses `key_<random>`)
- `name`       — human-readable label
- `token_prefix` — first 16 chars of the token; used for display, not for auth
- `token_hash` — `sha256(token)` in lowercase hex
- `scopes_json` — JSON array, e.g. `["dashboard:read","api:write"]`
- `workspace_keys_json` — JSON array of workspace keys, or `NULL` for any
- `created_at` / `updated_at` — UTC ISO timestamps ending in `Z`
- `expires_at` / `revoked_at` / `last_used_at` — leave `NULL` initially

### One-shot helper

Run this from the repo root to mint a token and print the matching `INSERT` statement. The token itself is shown once; copy it before closing the terminal:

```bash
node -e '
const crypto = require("crypto");
const tok    = "ttok_" + crypto.randomBytes(32).toString("base64url");
const hash   = crypto.createHash("sha256").update(tok).digest("hex");
const id     = "key_" + crypto.randomBytes(12).toString("hex");
const now    = new Date().toISOString();
const name   = "dashboard";
const scopes = ["dashboard:read", "api:write"];
const wsKeys = ["ttoksem-dev"];
console.log("TOKEN (save this — it cannot be recovered):");
console.log("  " + tok);
console.log();
console.log("SQL:");
console.log("INSERT INTO access_keys (id, name, token_prefix, token_hash, scopes_json, workspace_keys_json, created_at, updated_at)");
console.log("VALUES (");
console.log("  " + JSON.stringify(id) + ",");
console.log("  " + JSON.stringify(name) + ",");
console.log("  " + JSON.stringify(tok.slice(0, 16)) + ",");
console.log("  " + JSON.stringify(hash) + ",");
console.log("  " + JSON.stringify(JSON.stringify(scopes)) + ",");
console.log("  " + JSON.stringify(JSON.stringify(wsKeys)) + ",");
console.log("  " + JSON.stringify(now) + ",");
console.log("  " + JSON.stringify(now));
console.log(");");'
```

Then apply the printed SQL with `wrangler`:

```bash
wrangler d1 execute ttoksem --command "INSERT INTO access_keys (...) VALUES (...);"
```

Or pipe via a file: `wrangler d1 execute ttoksem --file ./issue-key.sql`.

### Listing keys

```bash
wrangler d1 execute ttoksem --command "
  SELECT id, name, token_prefix, scopes_json, revoked_at
  FROM access_keys
  ORDER BY created_at DESC;
"
```

The token itself is never stored, so you can only see prefix + hash. If a token is lost, revoke and reissue.

### Revoking a key

```bash
wrangler d1 execute ttoksem --command "
  UPDATE access_keys
  SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'key_xxxxxxxxxxxxxxxxxxxxxxxx';
"
```

The Worker treats any row with a non-null `revoked_at` as forbidden, so the next request from that token returns 401 without further action.

### Scopes worth knowing

- `dashboard:read` — required for everything the dashboard renders (`/`, `/inbox`, `/tasks/...`, the readonly `/api/*` endpoints)
- `api:write` — required for state-changing endpoints (task create/update/close, usage record/move/repricing, inbox assign/accept/reject, workspace create)
- `*` — wildcard; matches any required scope

A key issued for human dashboard use should normally carry both `dashboard:read` and `api:write` so the inbox assign/accept buttons stay enabled. A key issued for an automated importer should carry just `api:write`.
