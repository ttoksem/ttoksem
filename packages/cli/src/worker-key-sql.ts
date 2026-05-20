/**
 * Builders for `access_keys` SQL run against a deployed D1 via `wrangler d1 execute`.
 * `wrangler d1 execute` takes a raw SQL string with no bound parameters, so every
 * value is inlined — `sqlString` escapes it as a SQLite string literal.
 */

export interface AccessKeyRow {
  id: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: string[];
  workspaceKeys: string[] | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A SQLite string literal: wrap in single quotes, double any internal quote. */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlStringOrNull(value: string | null): string {
  return value === null ? "NULL" : sqlString(value);
}

export function buildInsertAccessKeySql(row: AccessKeyRow): string {
  const columns = [
    "id",
    "name",
    "token_prefix",
    "token_hash",
    "scopes_json",
    "workspace_keys_json",
    "expires_at",
    "created_at",
    "updated_at",
  ].join(", ");
  const values = [
    sqlString(row.id),
    sqlString(row.name),
    sqlString(row.tokenPrefix),
    sqlString(row.tokenHash),
    sqlString(JSON.stringify(row.scopes)),
    row.workspaceKeys && row.workspaceKeys.length > 0
      ? sqlString(JSON.stringify(row.workspaceKeys))
      : "NULL",
    sqlStringOrNull(row.expiresAt),
    sqlString(row.createdAt),
    sqlString(row.updatedAt),
  ].join(", ");
  return `INSERT INTO access_keys (${columns}) VALUES (${values});`;
}

export function buildListAccessKeysSql(): string {
  return (
    "SELECT id, name, token_prefix, scopes_json, workspace_keys_json, " +
    "expires_at, revoked_at, last_used_at, created_at " +
    "FROM access_keys ORDER BY created_at DESC;"
  );
}

export function buildRevokeAccessKeySql(id: string, revokedAt: string): string {
  return (
    `UPDATE access_keys SET revoked_at = ${sqlString(revokedAt)}, ` +
    `updated_at = ${sqlString(revokedAt)} WHERE id = ${sqlString(id)};`
  );
}
