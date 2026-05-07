import type { Ledger, LocalLedger } from "@ttoksem/core";
import { HttpLedgerClient } from "@ttoksem/ledger-http";

export interface LedgerHandle {
  /** The underlying ledger surface. Use `requireLocalLedger(handle)` to narrow when admin/local capabilities are needed. */
  ledger: Ledger;
  /** True iff `ledger` is a `LocalLedger` (has filesystem + admin capabilities). False for HttpLedgerClient. */
  isLocal: boolean;
  /** Tear down any resources held by the ledger (e.g., closing a SQLite handle). No-op in remote mode. */
  close: () => Promise<void>;
}

export interface MakeLedgerOptions {
  /**
   * Local-mode factory: builds the LocalLedger (LedgerService) plus a close
   * handler. Called only when TTOKSEM_HTTP_URL is unset, so the factory may
   * perform local-store side effects (e.g., service.init()).
   */
  makeLocalService: () => Promise<{ service: LocalLedger; close: () => Promise<void> }>;
  /** Workspace key to fall back on when a method receives no explicit workspace resolver. Forwarded to HttpLedgerClient in remote mode. */
  defaultWorkspaceKey?: string;
}

/**
 * Build a Ledger from environment configuration.
 * - TTOKSEM_HTTP_URL set → HttpLedgerClient (remote mode; Ledger only).
 * - Unset → local LedgerService (LocalLedger; admin + filesystem ops available).
 *
 * Bearer token is read from TTOKSEM_HTTP_TOKEN. When the server runs in
 * `auth: { mode: "none" }` (e.g., a private intranet deployment), the
 * token may be omitted.
 */
export async function makeLedger(opts: MakeLedgerOptions): Promise<LedgerHandle> {
  const httpUrl = process.env.TTOKSEM_HTTP_URL;
  if (httpUrl) {
    const client = new HttpLedgerClient({
      baseUrl: httpUrl,
      token: process.env.TTOKSEM_HTTP_TOKEN,
      defaultWorkspaceKey: opts.defaultWorkspaceKey,
    });
    return { ledger: client, isLocal: false, close: async () => {} };
  }
  const { service, close } = await opts.makeLocalService();
  return { ledger: service, isLocal: true, close };
}

/**
 * Narrow a LedgerHandle to LocalLedger or throw a clear error.
 *
 * Use this in subcommand bodies that need admin or filesystem
 * capabilities (workspace.init, auth.key.*, pricing.upsert, usage.reprice,
 * usage.import-claude-sessions, etc.). In remote mode the throw fires
 * before any HTTP call, so users see a clear "requires local DB" error
 * rather than a confusing 401/404/410 from the server.
 */
export function requireLocalLedger(handle: LedgerHandle): LocalLedger {
  if (!handle.isLocal) {
    throw new Error(
      "This subcommand requires a local DB and is not available in remote mode. " +
      "Unset TTOKSEM_HTTP_URL or run the command on the server host.",
    );
  }
  return handle.ledger as LocalLedger;
}
