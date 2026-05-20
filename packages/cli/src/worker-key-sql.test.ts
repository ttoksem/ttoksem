import { describe, it, expect } from "vitest";
import {
  buildInsertAccessKeySql,
  buildListAccessKeysSql,
  buildRevokeAccessKeySql,
} from "./worker-key-sql.js";

const row = {
  id: "key_abc",
  name: "ci",
  tokenPrefix: "ttok_abcdefghijk",
  tokenHash: "f".repeat(64),
  scopes: ["dashboard:read", "api:write"],
  workspaceKeys: null,
  expiresAt: null,
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
};

describe("worker-key-sql", () => {
  it("buildInsertAccessKeySql lists the access_keys columns and values", () => {
    const sql = buildInsertAccessKeySql(row);
    expect(sql).toContain("INSERT INTO access_keys (");
    expect(sql).toContain("token_hash");
    expect(sql).toContain("'key_abc'");
    expect(sql).toContain(`'${JSON.stringify(["dashboard:read", "api:write"])}'`);
  });
  it("uses NULL for absent workspace_keys and expires_at", () => {
    const sql = buildInsertAccessKeySql(row);
    expect(sql).toMatch(/NULL/);
  });
  it("escapes single quotes in user-supplied values (no SQL injection)", () => {
    const sql = buildInsertAccessKeySql({ ...row, name: "o'brien'); DROP TABLE access_keys;--" });
    expect(sql).toContain("'o''brien''); DROP TABLE access_keys;--'");
    expect(sql).not.toContain("'o'brien'");
  });
  it("buildListAccessKeysSql selects non-secret columns only", () => {
    const sql = buildListAccessKeysSql();
    expect(sql).toContain("SELECT");
    expect(sql).toContain("access_keys");
    expect(sql).not.toContain("token_hash");
  });
  it("buildRevokeAccessKeySql sets revoked_at for the given id", () => {
    const sql = buildRevokeAccessKeySql("key_abc", "2026-05-20T01:00:00.000Z");
    expect(sql).toContain("UPDATE access_keys");
    expect(sql).toContain("revoked_at");
    expect(sql).toContain("'key_abc'");
  });
});
