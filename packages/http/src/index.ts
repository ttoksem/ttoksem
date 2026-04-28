import { Hono, type Context } from "hono";
import { renderDashboardHtml } from "./dashboard-html.js";
import type { LedgerService, WorkspaceResolver } from "@ttoksem/core";

export interface CreateHttpAppOptions {
  service: LedgerService;
  defaultWorkspaceKey?: string;
  auth?: HttpAuthOptions;
}

export type HttpAuthOptions =
  | { mode: "none" }
  | {
      mode: "access-key";
      verifyAccessToken(input: {
        workspaceKey: string;
        token: string;
        requiredScopes: string[];
      }): Promise<boolean>;
    };

export function createHttpApp(options: CreateHttpAppOptions): Hono {
  const app = new Hono();
  const defaultWorkspaceKey = options.defaultWorkspaceKey ?? "ttoksem-dev";

  app.get("/health", (context) =>
    context.json({
      ok: true,
      service: "ttoksem-http",
    }),
  );

  app.get("/api/dashboard", async (context) => {
    const workspaceKey = context.req.query("workspace") ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(context, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse;
    const data = await options.service.dashboard({
      workspace: workspaceResolver(workspaceKey),
      taskLimit: parseLimit(context.req.query("taskLimit"), 80),
      recentLimit: parseLimit(context.req.query("recentLimit"), 80),
      dayLimit: parseLimit(context.req.query("dayLimit"), 30),
      timeZoneOffsetMinutes: parseTimeZoneOffset(context.req.query("tzOffsetMinutes")),
    });
    return context.json(data);
  });

  app.get("/api/tasks/:taskKey", async (context) => {
    const workspaceKey = context.req.query("workspace") ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(context, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse;
    const data = await options.service.dashboardTask({
      workspace: workspaceResolver(workspaceKey),
      taskKey: context.req.param("taskKey"),
      recentLimit: parseLimit(context.req.query("eventLimit"), 150),
      dayLimit: parseLimit(context.req.query("dayLimit"), 60),
      runLimit: parseLimit(context.req.query("runLimit"), 150),
      timeZoneOffsetMinutes: parseTimeZoneOffset(context.req.query("tzOffsetMinutes")),
    });
    return context.json(data);
  });

  app.get("/", (context) => context.html(renderDashboardHtml(defaultWorkspaceKey, null)));
  app.get("/tasks/:taskKey", (context) =>
    context.html(renderDashboardHtml(defaultWorkspaceKey, context.req.param("taskKey"))),
  );

  app.onError((error, context) =>
    context.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    ),
  );

  return app;
}

function workspaceResolver(workspaceKey: string): WorkspaceResolver {
  return {
    key: workspaceKey,
  };
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 200);
}

function parseTimeZoneOffset(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 14 * 60) return undefined;
  return parsed;
}

async function authorizeRequest(
  context: Context,
  auth: HttpAuthOptions | undefined,
  workspaceKey: string,
  requiredScopes: string[],
): Promise<Response | null> {
  if (!auth || auth.mode === "none") return null;
  const token = bearerToken(context) ?? context.req.query("token");
  if (!token) {
    return context.json(
      {
        error: "Unauthorized",
        detail: "Provide a database access key with Authorization: Bearer <token>.",
      },
      401,
    );
  }
  const allowed = await auth.verifyAccessToken({ workspaceKey, token, requiredScopes });
  if (!allowed) {
    return context.json(
      {
        error: "Forbidden",
        detail: `Access key is missing required scope: ${requiredScopes.join(",")}.`,
      },
      403,
    );
  }
  return null;
}

function bearerToken(context: Context): string | null {
  const header = context.req.header("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
