import type { Ledger } from "@ttoksem/core";
import type { WorkspaceResolver } from "@ttoksem/core";
import { HttpLedgerError } from "./errors.js";

export interface HttpLedgerClientOptions {
  baseUrl: string;
  token?: string;
  defaultWorkspaceKey?: string;
  fetch?: typeof globalThis.fetch;
}

export class HttpLedgerClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly defaultWorkspaceKey: string | undefined;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: HttpLedgerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.defaultWorkspaceKey = options.defaultWorkspaceKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  protected async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (cause) {
      throw new HttpLedgerError(`Network error: ${cause instanceof Error ? cause.message : String(cause)}`, 0);
    }

    if (response.status === 204) return undefined;

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new HttpLedgerError(`Server returned non-JSON response: ${text.slice(0, 100)}`, response.status);
        }
      }
    }

    if (!response.ok) {
      const body = (parsed && typeof parsed === "object") ? (parsed as { error?: string; detail?: string }) : undefined;
      throw new HttpLedgerError(`HTTP ${response.status}`, response.status, body);
    }

    return parsed;
  }

  protected resolveWorkspaceKey(resolver: WorkspaceResolver | undefined): string {
    if (resolver && "key" in resolver && typeof resolver.key === "string") return resolver.key;
    if (this.defaultWorkspaceKey) return this.defaultWorkspaceKey;
    if (resolver && "rootPath" in resolver) {
      throw new HttpLedgerError(
        "rootPath workspace resolver is not supported in remote mode; resolve to a workspace key first",
        0,
      );
    }
    throw new HttpLedgerError("No workspace key provided and no defaultWorkspaceKey configured", 0);
  }
}

// Type shim — HttpLedgerClient does not yet implement Ledger (methods land in
// Tasks 2-5). The shim variable assignment will fail at compile time once any
// method is referenced through this typing path, alerting us if Task 5 forgets
// to swap to `class HttpLedgerClient implements Ledger`.
// We deliberately do NOT add `implements Ledger` to the class declaration yet;
// that lands in Task 5 once all 28 methods exist.
