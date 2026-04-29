import { type Context } from "hono";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { renderDashboardHtml } from "./dashboard-html.js";
import type { LedgerService, WorkspaceResolver } from "@ttoksem/core";
import { AiUsageObservedSchema } from "@ttoksem/schema";

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

// ── OpenAPI schemas ──────────────────────────────────────────────────────────

const TaskStatsSchema = z.object({
  key: z.string(),
  status: z.string(),
  run_count: z.number().int(),
  event_count: z.number().int(),
  estimated_cost_nanos: z.number().int(),
  unpriced_count: z.number().int(),
  first_activity_at: z.string().nullable(),
  last_activity_at: z.string().nullable(),
});

const ErrorSchema = z.object({
  error: z.string(),
  detail: z.string().optional(),
});

// ── Route definitions ─────────────────────────────────────────────────────────

const routeTaskActive = createRoute({
  method: "get",
  path: "/api/tasks/active",
  tags: ["Tasks"],
  summary: "Get the most recently started active task key",
  request: {
    query: z.object({ workspace: z.string().optional() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ key: z.string().nullable() }) } },
      description: "Active task key, or null if none",
    },
  },
});

const routeTaskStats = createRoute({
  method: "get",
  path: "/api/tasks/{taskKey}/stats",
  tags: ["Tasks"],
  summary: "Get run count, event count, and cost stats for a task",
  request: {
    params: z.object({ taskKey: z.string() }),
    query: z.object({ workspace: z.string().optional() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: TaskStatsSchema } },
      description: "Task stats",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Task not found",
    },
  },
});

const routeUsageLastImport = createRoute({
  method: "get",
  path: "/api/usage/last-import",
  tags: ["Usage"],
  summary: "Get the occurred_at of the last imported event for a given source",
  request: {
    query: z.object({
      workspace: z.string().optional(),
      source: z.string().default("claude-session"),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ occurred_at: z.string().nullable() }) } },
      description: "Last import timestamp",
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────────

export function createHttpApp(options: CreateHttpAppOptions): OpenAPIHono {
  const app = new OpenAPIHono();
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

  app.post("/api/workspaces", async (context) => {
    const body = await readJsonObject(context);
    const workspaceKey = requiredString(body, "key");
    const authResponse = await authorizeRequest(context, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse;
    const workspace = await options.service.createWorkspace({
      key: workspaceKey,
      name: optionalString(body, "name"),
      rootPath: optionalNullableString(body, "root_path") ?? optionalNullableString(body, "rootPath"),
    });
    return context.json({ workspace }, 201);
  });

  app.post("/api/tasks", async (context) => {
    const body = await readJsonObject(context);
    const workspaceKey = workspaceKeyFromRequest(context, body, defaultWorkspaceKey);
    const authResponse = await authorizeRequest(context, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse;
    const key = requiredString(body, "key");
    const task = await options.service.startTask({
      workspace: workspaceResolver(workspaceKey),
      key,
      name: optionalString(body, "name") ?? key,
      description: optionalNullableString(body, "description"),
    });
    return context.json({ task }, 201);
  });

  app.patch("/api/tasks/:taskKey", async (context) => {
    const body = await readJsonObject(context);
    const workspaceKey = workspaceKeyFromRequest(context, body, defaultWorkspaceKey);
    const authResponse = await authorizeRequest(context, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse;
    const update = {
      workspace: workspaceResolver(workspaceKey),
      key: context.req.param("taskKey"),
      ...(Object.hasOwn(body, "name") ? { name: requiredString(body, "name") } : {}),
      ...(Object.hasOwn(body, "description")
        ? { description: optionalNullableString(body, "description") }
        : {}),
    };
    if (!Object.hasOwn(update, "name") && !Object.hasOwn(update, "description")) {
      return badRequest(context, "Provide name or description.");
    }
    const task = await options.service.updateTask(update);
    return context.json({ task });
  });

  app.post("/api/tasks/:taskKey/close", async (context) => {
    const body = await readOptionalJsonObject(context);
    const workspaceKey = workspaceKeyFromRequest(context, body, defaultWorkspaceKey);
    const authResponse = await authorizeRequest(context, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse;
    const task = await options.service.closeTask({
      workspace: workspaceResolver(workspaceKey),
      key: context.req.param("taskKey"),
    });
    return context.json({ task });
  });

  app.post("/api/usage/events", async (context) => {
    const body = await readJsonObject(context);
    const workspaceKey = workspaceKeyFromUsageMessage(context, body, defaultWorkspaceKey);
    const authResponse = await authorizeRequest(context, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse;
    const message = AiUsageObservedSchema.parse(usageMessageWithWorkspace(body, workspaceKey));
    const usageEvent = await options.service.recordUsage(message);
    return context.json({ usage_event: usageEvent }, 201);
  });

  app.post("/api/usage/events/:usageId/move", async (context) => {
    const body = await readJsonObject(context);
    const workspaceKey = workspaceKeyFromRequest(context, body, defaultWorkspaceKey);
    const authResponse = await authorizeRequest(context, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse;
    const usageEvent = await options.service.moveUsage({
      workspace: workspaceResolver(workspaceKey),
      usageEventId: context.req.param("usageId"),
      taskKey: requiredString(body, "task_key"),
    });
    return context.json({ usage_event: usageEvent });
  });

  app.post("/api/inbox/:groupId/assign", async (context) => {
    const body = await readJsonObject(context);
    const workspaceKey = workspaceKeyFromRequest(context, body, defaultWorkspaceKey);
    const authResponse = await authorizeRequest(context, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse;
    const result = await options.service.assignInboxGroup({
      workspace: workspaceResolver(workspaceKey),
      groupId: context.req.param("groupId"),
      taskKey: requiredString(body, "task_key"),
      all: optionalBoolean(body, "all"),
    });
    return context.json(result);
  });

  app.post("/api/inbox/:groupId/accept", async (context) => {
    const body = await readOptionalJsonObject(context);
    const workspaceKey = workspaceKeyFromRequest(context, body, defaultWorkspaceKey);
    const authResponse = await authorizeRequest(context, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse;
    const result = await options.service.acceptInboxGroup({
      workspace: workspaceResolver(workspaceKey),
      groupId: context.req.param("groupId"),
      all: optionalBoolean(body, "all"),
    });
    return context.json(result);
  });

  app.post("/api/inbox/events/:usageId/assign", async (context) => {
    const body = await readJsonObject(context);
    const workspaceKey = workspaceKeyFromRequest(context, body, defaultWorkspaceKey);
    const authResponse = await authorizeRequest(context, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse;
    const usageEvent = await options.service.assignInboxEvent({
      workspace: workspaceResolver(workspaceKey),
      usageEventId: context.req.param("usageId"),
      taskKey: requiredString(body, "task_key"),
    });
    return context.json({ usage_event: usageEvent });
  });

  // ── OpenAPI routes ──────────────────────────────────────────────────────────

  app.openapi(routeTaskActive, async (c) => {
    const workspaceKey = c.req.valid("query").workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const tasks = await options.service.listTasks({ workspace: workspaceResolver(workspaceKey) });
    const active = tasks
      .filter((t) => t.status === "active")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    return c.json({ key: active?.key ?? null }, 200);
  });

  app.openapi(routeTaskStats, async (c) => {
    const workspaceKey = c.req.valid("query").workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const { taskKey } = c.req.valid("param");
    try {
      const stats = await options.service.getTaskStats({ workspace: workspaceResolver(workspaceKey), key: taskKey });
      return c.json(stats, 200);
    } catch {
      return c.json({ error: "Task not found" }, 404);
    }
  });

  app.openapi(routeUsageLastImport, async (c) => {
    const { workspace, source } = c.req.valid("query");
    const workspaceKey = workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const occurred_at = await options.service.getLastImportedAt({ workspace: workspaceResolver(workspaceKey), source });
    return c.json({ occurred_at }, 200);
  });

  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: { title: "ttoksem API", version: "0.0.0" },
  });

  // ── HTML dashboard ──────────────────────────────────────────────────────────

  app.get("/", (context) => context.html(renderDashboardHtml(defaultWorkspaceKey, null)));
  app.get("/tasks/:taskKey", (context) =>
    context.html(renderDashboardHtml(defaultWorkspaceKey, context.req.param("taskKey"))),
  );

  app.onError((error, context) =>
    context.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      isRequestValidationError(error) ? 400 : 500,
    ),
  );

  return app;
}

export type HttpApp = ReturnType<typeof createHttpApp>;

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

async function readJsonObject(context: Context): Promise<Record<string, unknown>> {
  const body = await readOptionalJsonObject(context);
  if (Object.keys(body).length === 0) throw new Error("Request body must be a JSON object.");
  return body;
}

async function readOptionalJsonObject(context: Context): Promise<Record<string, unknown>> {
  const contentType = context.req.header("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  const value = (await context.req.json().catch(() => null)) as unknown;
  if (value == null) return {};
  if (!isRecord(value)) throw new Error("Request body must be a JSON object.");
  return value;
}

function workspaceKeyFromRequest(
  context: Context,
  body: Record<string, unknown>,
  defaultWorkspaceKey: string,
): string {
  return optionalString(body, "workspace") ?? context.req.query("workspace") ?? defaultWorkspaceKey;
}

function workspaceKeyFromUsageMessage(
  context: Context,
  body: Record<string, unknown>,
  defaultWorkspaceKey: string,
): string {
  const workspace = isRecord(body.workspace) ? body.workspace : null;
  return stringValue(workspace?.key) ?? context.req.query("workspace") ?? defaultWorkspaceKey;
}

function usageMessageWithWorkspace(
  body: Record<string, unknown>,
  workspaceKey: string,
): Record<string, unknown> {
  const workspace = isRecord(body.workspace) ? body.workspace : {};
  return {
    ...body,
    workspace: {
      ...workspace,
      key: stringValue(workspace.key) ?? workspaceKey,
    },
  };
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = stringValue(body[field]);
  if (!value) throw new Error(`Missing required field: ${field}`);
  return value;
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  return stringValue(body[field]) ?? undefined;
}

function optionalNullableString(body: Record<string, unknown>, field: string): string | null | undefined {
  if (!Object.hasOwn(body, field)) return undefined;
  if (body[field] == null) return null;
  return requiredString(body, field);
}

function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  if (!Object.hasOwn(body, field)) return undefined;
  if (typeof body[field] !== "boolean") throw new Error(`Field must be boolean: ${field}`);
  return body[field];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function badRequest(context: Context, detail: string): Response {
  return context.json({ error: "Bad Request", detail }, 400);
}

function isRequestValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.startsWith("Missing required field:") ||
    error.message.startsWith("Field must be boolean:") ||
    error.message === "Request body must be a JSON object." ||
    error.name === "ZodError"
  );
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
