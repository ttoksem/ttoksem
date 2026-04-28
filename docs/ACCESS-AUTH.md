# Access Key Auth

ttoksem uses database access keys for local HTTP and dashboard access. This is not a user account system and it is not RBAC.

The goal is to prevent accidental exposure of ledger data when a dashboard, HTTP API, or future HTTP MCP endpoint is reachable by more than one person or process.

## Boundary

- CLI commands use the local OS user boundary.
- Dashboard data APIs require a database access key by default.
- Read-only dashboard APIs require `dashboard:read`.
- A key can optionally be restricted to specific workspace keys.
- Future write APIs should require a narrower write scope such as `usage:write`.
- MCP over stdio can stay unauthenticated because the local process launch is the boundary.
- MCP over HTTP/SSE should reuse the same access-key guard as HTTP.

## Storage

Access keys are stored per ledger database. The token itself is only shown once at creation time.

The database stores:

```text
id
name
token_prefix
token_hash
scopes_json
workspace_keys_json
expires_at
revoked_at
last_used_at
created_at
updated_at
```

`token_hash` is a SHA-256 hash of the full random token. `token_prefix` is only for display and audit.

`workspace_keys_json` is `null` for all workspaces in the DB. When it contains keys, the token is only accepted for those workspaces.

## CLI

Create one key per person or integration instead of sharing one token:

```bash
pnpm cli auth key create \
  --name "hwanghee dashboard" \
  --scope dashboard:read
```

Create a key limited to one workspace:

```bash
pnpm cli auth key create \
  --name "project dashboard" \
  --scope dashboard:read \
  --workspace-scope ttoksem-dev
```

List keys without exposing token secrets:

```bash
pnpm cli auth key list
```

Revoke a key:

```bash
pnpm cli auth key revoke <key_id>
```

## Dashboard

`dashboard serve` uses access-key auth by default.

If the database has no active key that can read the served workspace, the command creates one persistent unrestricted `dashboard:read` key and prints its token once. That token survives server restarts because the key is stored in the ledger database.

```bash
pnpm cli dashboard serve --workspace ttoksem-dev --port 4317
```

For development-only no-auth mode:

```bash
pnpm cli dashboard serve --workspace ttoksem-dev --auth none
```

If `--auth none` is used on a non-loopback host, the CLI requires `--unsafe-no-auth`.
