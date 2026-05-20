/**
 * remote-import-server.ts
 *
 * Minimal HTTP server fixture for remote-import.test.ts.
 * Spawned as a sibling subprocess so its TCP port is reachable from
 * the CLI subprocess (macOS sandbox prevents parent→child TCP, but
 * sibling→sibling works fine).
 *
 * Usage: tsx remote-import-server.ts --db-path <path> --workspace <key>
 *
 * On startup, prints one line to stdout:
 *   READY:<port>
 *
 * Stays alive until it receives SIGTERM or the parent closes its stdin.
 * Exits cleanly when killed.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { SqliteLedgerStore } from "@ttoksem/storage-sqlite";
import { LedgerService } from "@ttoksem/core";
import { createHttpApp } from "@ttoksem/http";

// Parse CLI args: --db-path <path> --workspace <key>
const args = process.argv.slice(2);
let dbPath = "";
let workspaceKey = "ttoksem-dev";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--db-path" && args[i + 1]) { dbPath = args[++i]; }
  else if (args[i] === "--workspace" && args[i + 1]) { workspaceKey = args[++i]; }
}
if (!dbPath) {
  process.stderr.write("remote-import-server: --db-path is required\n");
  process.exit(1);
}

const store = new SqliteLedgerStore(dbPath);
const service = new LedgerService({ store });
await service.init();
await service.createWorkspace({ key: workspaceKey, name: workspaceKey, rootPath: dbPath });

const app = createHttpApp({
  service,
  defaultWorkspaceKey: workspaceKey,
  auth: { mode: "none" },
  logRequests: false,
});

// Only forward safe, non-hop-by-hop headers.
const SAFE_HEADERS = new Set([
  "accept", "content-type", "authorization", "x-workspace", "x-request-id",
]);

const server = createServer(async (req, res) => {
  try {
    const url = `http://127.0.0.1${req.url}`;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (SAFE_HEADERS.has(key.toLowerCase()) && typeof value === "string") {
        headers[key] = value;
      }
    }
    const method = req.method ?? "GET";
    // Only read body for request methods that can carry one.
    // Avoid for await on GET/HEAD/DELETE — keep-alive connections
    // don't emit 'end' until the connection closes.
    const hasBody = !["GET", "HEAD", "DELETE", "OPTIONS"].includes(method.toUpperCase());
    let body: string | undefined;
    if (hasBody) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const buf = Buffer.concat(chunks);
      body = buf.length > 0 ? buf.toString("utf8") : undefined;
    }
    const fetchReq = new Request(url, { method, headers, body });
    const response = await app.fetch(fetchReq);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => { res.setHeader(key, value); });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err));
  }
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  // Signal readiness to the test process.
  process.stdout.write(`READY:${port}\n`);
});

// Graceful shutdown on SIGTERM
const shutdown = async () => {
  server.close();
  await store.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Also exit if stdin closes (parent died)
process.stdin.on("end", shutdown);
process.stdin.resume();
