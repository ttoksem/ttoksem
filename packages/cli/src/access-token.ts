import { createHash, randomBytes } from "node:crypto";

/** A random access token, prefixed `ttok_`. Shown to the user once; never stored. */
export function generateAccessToken(): string {
  return `ttok_${randomBytes(32).toString("base64url")}`;
}

/** Lowercase-hex SHA-256 of a token — what is stored as `access_keys.token_hash`. */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** First 16 chars of a token — stored as `token_prefix` for display/audit only. */
export function tokenPrefix(token: string): string {
  return token.slice(0, 16);
}
