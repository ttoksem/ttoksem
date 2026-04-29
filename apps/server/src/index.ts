import { createHash } from "node:crypto";
import { serve } from "@hono/node-server";
import { LedgerService } from "@ttoksem/core";
import { createHttpApp } from "@ttoksem/http";
import { SqliteLedgerStore } from "@ttoksem/storage-sqlite";

export interface ServeDashboardOptions {
  dbPath: string;
  workspaceKey: string;
  hostname?: string;
  port?: number;
  authMode?: "access-key" | "none";
  /** Override the server URL advertised in /openapi.json. Defaults to http://{hostname}:{port}. */
  serverUrl?: string;
}

export interface RunningDashboardServer {
  url: string;
  close(): Promise<void>;
}

export async function serveDashboard(options: ServeDashboardOptions): Promise<RunningDashboardServer> {
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 4317;
  const serverUrl = options.serverUrl ?? `http://${hostname}:${port}`;
  const store = new SqliteLedgerStore(options.dbPath);
  const service = new LedgerService({ store });
  await service.init();
  const app = createHttpApp({
    service,
    defaultWorkspaceKey: options.workspaceKey,
    serverUrl,
    auth:
      options.authMode === "none"
        ? { mode: "none" }
        : {
            mode: "access-key",
            verifyAccessToken: async ({ workspaceKey, token, requiredScopes }) => {
              const result = await service.verifyAccessKey({
                workspaceKey,
                tokenHash: hashAccessToken(token),
                requiredScopes,
              });
              return result.allowed;
            },
          },
  });
  const server = serve({
    fetch: app.fetch,
    hostname,
    port,
  });

  return {
    url: `http://${hostname}:${port}/?workspace=${encodeURIComponent(options.workspaceKey)}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await store.close();
    },
  };
}

function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
