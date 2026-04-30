import { LedgerService } from "@ttoksem/core";
import { createHttpApp } from "@ttoksem/http";
import { D1LedgerStore, type D1Database } from "@ttoksem/storage-d1";

export interface WorkerEnv {
  TTOKSEM_DB: D1Database;
  TTOKSEM_WORKSPACE_KEY?: string;
  TTOKSEM_AUTH_MODE?: "access-key" | "none";
  TTOKSEM_SERVER_URL?: string;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const store = new D1LedgerStore(env.TTOKSEM_DB);
    const service = new LedgerService({ store });
    await service.init();
    const authMode = env.TTOKSEM_AUTH_MODE ?? "access-key";
    const app = createHttpApp({
      service,
      defaultWorkspaceKey: env.TTOKSEM_WORKSPACE_KEY ?? "ttoksem-dev",
      serverUrl: env.TTOKSEM_SERVER_URL,
      auth:
        authMode === "none"
          ? { mode: "none" }
          : {
              mode: "access-key",
              verifyAccessToken: async ({ workspaceKey, token, requiredScopes }) => {
                const result = await service.verifyAccessKey({
                  workspaceKey,
                  tokenHash: await hashAccessToken(token),
                  requiredScopes,
                });
                return result.allowed;
              },
              // Mirror apps/server: dashboard's /api/me/permissions needs token
              // introspection so the UI can gate write-class affordances on
              // the actual scopes. Without this the worker returned 501 and
              // the client fell back to assuming everything was permitted.
              describeAccessToken: async ({ workspaceKey, token }) => {
                const result = await service.verifyAccessKey({
                  workspaceKey,
                  tokenHash: await hashAccessToken(token),
                  requiredScopes: ["dashboard:read"],
                });
                if (!result.key) return null;
                return { scopes: result.key.scopes_json };
              },
            },
    });
    return app.fetch(request, env);
  },
};

async function hashAccessToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
