import { createHash, randomBytes } from "node:crypto";
import type { Command } from "commander";
import type { LocalLedger } from "@ttoksem/core";
import type { AccessKeyRecord } from "@ttoksem/schema";
import type { LedgerHandle } from "./ledger-factory.js";

export type AuthMode = "access-key" | "none";

/** @deprecated Use MakeLedgerFn + RequireLocalLedgerFn instead. Kept for backwards compat. */
export type MakeService = () => Promise<{ service: LocalLedger; close: () => Promise<void> }>;

export type MakeLedgerFn = () => Promise<LedgerHandle>;
export type RequireLocalLedgerFn = (handle: LedgerHandle) => LocalLedger;
export type MakeLocalServiceFn = () => Promise<{ service: LocalLedger; close: () => Promise<void> }>;

interface AuthKeyCreateOptions {
  name?: string;
  scope: string[];
  workspaceScope: string[];
  expiresAt?: string;
}

export function registerAuthCommands(
  program: Command,
  _makeService: MakeService,
  makeLedgerFn: MakeLedgerFn,
  requireLocalLedgerFn: RequireLocalLedgerFn,
): void {
  const auth = program.command("auth").description("Access key commands");
  const authKey = auth.command("key").description("Database access key commands");

  authKey
    .command("create")
    .option("--name <name>", "access key name (default: 'key-<timestamp>')")
    .option("--scope <scope>", "scope; may be repeated or comma-separated", collectOption, [])
    .option("--workspace-scope <key>", "restrict key to a workspace key; may be repeated or comma-separated", collectOption, [])
    .option("--expires-at <iso>", "UTC ISO timestamp when this key expires")
    .description("Create a persistent database access key")
    .action(async (options: AuthKeyCreateOptions) => {
      const handle = await makeLedgerFn();
      try {
        const service = requireLocalLedgerFn(handle);
        // Default name: 'key-YYYYMMDD-HHmmss' so a quick "create + paste token"
        // workflow doesn't fail on a missing flag. The user can still pass an
        // explicit --name when they want something more memorable.
        const defaultName = (() => {
          const d = new Date();
          const pad = (n: number) => String(n).padStart(2, "0");
          return `key-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
        })();
        const result = await createAccessKeyWithToken(service, {
          name: options.name ?? defaultName,
          scopes: options.scope.length > 0 ? options.scope : ["dashboard:read"],
          workspaceKeys: options.workspaceScope,
          expiresAt: options.expiresAt,
        });
        console.log(
          `access key ${result.key.id} prefix=${result.key.token_prefix} scopes=${result.key.scopes_json.join(",")} workspaces=${accessKeyWorkspaces(result.key)}`,
        );
        console.log(`token ${result.token}`);
      } finally {
        await handle.close();
      }
    });

  authKey
    .command("list")
    .description("List database access keys without showing token secrets")
    .action(async () => {
      const handle = await makeLedgerFn();
      try {
        const service = requireLocalLedgerFn(handle);
        const keys = await service.listAccessKeys();
        for (const key of keys) {
          printAccessKeyLine(key);
        }
      } finally {
        await handle.close();
      }
    });

  authKey
    .command("revoke")
    .argument("<id>", "access key id")
    .description("Revoke a database access key")
    .action(async (id: string) => {
      const handle = await makeLedgerFn();
      try {
        const service = requireLocalLedgerFn(handle);
        const key = await service.revokeAccessKey({ id });
        console.log(`access key ${key.id} revoked_at=${key.revoked_at ?? ""}`);
      } finally {
        await handle.close();
      }
    });
}

export async function ensureDashboardAccessKey(
  makeLedgerFn: MakeLedgerFn,
  requireLocalLedgerFn: RequireLocalLedgerFn,
  workspaceKey: string,
  name: string,
): Promise<{ key: AccessKeyRecord; token: string } | null> {
  const handle = await makeLedgerFn();
  try {
    const service = requireLocalLedgerFn(handle);
    const keys = await service.listAccessKeys();
    if (keys.some((key) => grantsDashboardAccess(key, workspaceKey))) return null;
    // Dashboard end-users own the workspace they're looking at, so the
    // auto-issued key carries both read and write scopes — the inbox
    // assign/accept flow needs api:write, and forcing users to mint a
    // second key just to clean up their own inbox would be hostile UX.
    return await createAccessKeyWithToken(service, {
      name,
      scopes: ["dashboard:read", "api:write"],
    });
  } finally {
    await handle.close();
  }
}

export function parseAuthMode(value: string): AuthMode {
  if (value === "access-key" || value === "none") return value;
  throw new Error(`Invalid auth mode: ${value}`);
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function appendQueryParam(url: string, key: string, value: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

async function createAccessKeyWithToken(
  service: LocalLedger,
  input: {
    name: string;
    scopes: string[];
    workspaceKeys?: string[];
    expiresAt?: string;
  },
): Promise<{ key: AccessKeyRecord; token: string }> {
  const token = generateAccessToken();
  const key = await service.createAccessKey({
    name: input.name,
    tokenPrefix: tokenPrefix(token),
    tokenHash: hashAccessToken(token),
    scopes: input.scopes,
    workspaceKeys: input.workspaceKeys,
    expiresAt: input.expiresAt,
  });
  return { key, token };
}

function generateAccessToken(): string {
  return `ttok_${randomBytes(32).toString("base64url")}`;
}

function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenPrefix(token: string): string {
  return token.slice(0, 16);
}

function printAccessKeyLine(key: AccessKeyRecord): void {
  console.log(
    [
      key.id,
      `name=${key.name}`,
      `prefix=${key.token_prefix}`,
      `scopes=${key.scopes_json.join(",")}`,
      `workspaces=${accessKeyWorkspaces(key)}`,
      `status=${accessKeyStatus(key)}`,
      key.expires_at ? `expires=${key.expires_at}` : "",
      key.last_used_at ? `last_used=${key.last_used_at}` : "",
      `created=${key.created_at}`,
    ]
      .filter(Boolean)
      .join("\t"),
  );
}

function accessKeyWorkspaces(key: AccessKeyRecord): string {
  return key.workspace_keys_json && key.workspace_keys_json.length > 0
    ? key.workspace_keys_json.join(",")
    : "all";
}

function accessKeyStatus(key: AccessKeyRecord): string {
  if (key.revoked_at) return "revoked";
  if (key.expires_at && key.expires_at <= new Date().toISOString()) return "expired";
  return "active";
}

function grantsDashboardAccess(key: AccessKeyRecord, workspaceKey: string): boolean {
  if (accessKeyStatus(key) !== "active") return false;
  if (!key.scopes_json.includes("*") && !key.scopes_json.includes("dashboard:read")) return false;
  return !key.workspace_keys_json || key.workspace_keys_json.length === 0 || key.workspace_keys_json.includes(workspaceKey);
}

function collectOption(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}
