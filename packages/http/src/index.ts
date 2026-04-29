import { type Context } from "hono";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { renderDashboardHtml } from "./dashboard-html.js";
import type { LedgerService, WorkspaceResolver } from "@ttoksem/core";
import {
  AiUsageObservedSchema,
  WorkspaceRecordSchema,
  TaskRecordSchema,
  UsageEventRecordSchema,
  PricingSourceSnapshotRecordSchema,
  PricingRuleRecordSchema,
} from "@ttoksem/schema";

export interface CreateHttpAppOptions {
  service: LedgerService;
  defaultWorkspaceKey?: string;
  auth?: HttpAuthOptions;
  serverUrl?: string;
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

// ── Shared query params ───────────────────────────────────────────────────────

const WorkspaceQuery = z.object({ workspace: z.string().optional() });
const TaskKeyParam = z.object({ taskKey: z.string() });

// ── Response schemas ──────────────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string(), detail: z.string().optional() });

const WorkspaceResponseSchema = z.object({ workspace: WorkspaceRecordSchema });
const TaskResponseSchema = z.object({ task: TaskRecordSchema });
const UsageEventResponseSchema = z.object({ usage_event: UsageEventRecordSchema });

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

const InboxAssignResultSchema = z.object({
  group: z.unknown(),
  task: z.object({ key: z.string(), name: z.string() }),
  assigned_count: z.number().int(),
  skipped_count: z.number().int(),
  assigned_event_ids: z.array(z.string()),
  skipped_event_ids: z.array(z.string()),
});

// ── Shared security ───────────────────────────────────────────────────────────

const BEARER_AUTH = [{ bearerAuth: [] as string[] }];

// ── Route definitions ─────────────────────────────────────────────────────────

const routeHealth = createRoute({
  method: "get", path: "/health", tags: ["System"],
  summary: "Health check",
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), service: z.string() }) } }, description: "OK" },
  },
});

const routeCreateWorkspace = createRoute({
  method: "post", path: "/api/workspaces", tags: ["Workspaces"],
  summary: "Create or activate a workspace", security: BEARER_AUTH,
  request: { body: { content: { "application/json": { schema: z.object({ key: z.string(), name: z.string().optional(), root_path: z.string().nullable().optional() }) } } } },
  responses: {
    201: { content: { "application/json": { schema: WorkspaceResponseSchema } }, description: "Workspace created" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad request" },
  },
});

const routeStartTask = createRoute({
  method: "post", path: "/api/tasks", tags: ["Tasks"],
  summary: "Create or activate a task", security: BEARER_AUTH,
  request: {
    query: WorkspaceQuery,
    body: { content: { "application/json": { schema: z.object({ key: z.string(), name: z.string().optional(), description: z.string().nullable().optional(), workspace: z.string().optional() }) } } },
  },
  responses: {
    201: { content: { "application/json": { schema: TaskResponseSchema } }, description: "Task started" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad request" },
  },
});

const routeUpdateTask = createRoute({
  method: "patch", path: "/api/tasks/{taskKey}", tags: ["Tasks"],
  summary: "Update task name or description", security: BEARER_AUTH,
  request: {
    params: TaskKeyParam,
    query: WorkspaceQuery,
    body: { content: { "application/json": { schema: z.object({ name: z.string().optional(), description: z.string().nullable().optional(), workspace: z.string().optional() }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: TaskResponseSchema } }, description: "Task updated" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad request" },
  },
});

const routeCloseTask = createRoute({
  method: "post", path: "/api/tasks/{taskKey}/close", tags: ["Tasks"],
  summary: "Close a task", security: BEARER_AUTH,
  request: { params: TaskKeyParam, query: WorkspaceQuery },
  responses: {
    200: { content: { "application/json": { schema: TaskResponseSchema } }, description: "Task closed" },
  },
});

const routeTaskActive = createRoute({
  method: "get", path: "/api/tasks/active", tags: ["Tasks"],
  summary: "Get the most recently started active task key", security: BEARER_AUTH,
  request: { query: WorkspaceQuery },
  responses: {
    200: { content: { "application/json": { schema: z.object({ key: z.string().nullable() }) } }, description: "Active task key or null" },
  },
});

const routeTaskStats = createRoute({
  method: "get", path: "/api/tasks/{taskKey}/stats", tags: ["Tasks"],
  summary: "Get run count, event count, and cost for a task", security: BEARER_AUTH,
  request: { params: TaskKeyParam, query: WorkspaceQuery },
  responses: {
    200: { content: { "application/json": { schema: TaskStatsSchema } }, description: "Task stats" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Task not found" },
  },
});

const routeDashboard = createRoute({
  method: "get", path: "/api/dashboard", tags: ["Dashboard"],
  summary: "Get workspace dashboard data", security: BEARER_AUTH,
  request: {
    query: WorkspaceQuery.extend({
      taskLimit: z.string().optional(),
      recentLimit: z.string().optional(),
      dayLimit: z.string().optional(),
      tzOffsetMinutes: z.string().optional(),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Dashboard data" },
  },
});

const routeDashboardTask = createRoute({
  method: "get", path: "/api/tasks/{taskKey}", tags: ["Dashboard"],
  summary: "Get task detail dashboard data", security: BEARER_AUTH,
  request: {
    params: TaskKeyParam,
    query: WorkspaceQuery.extend({
      eventLimit: z.string().optional(),
      dayLimit: z.string().optional(),
      runLimit: z.string().optional(),
      tzOffsetMinutes: z.string().optional(),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Task dashboard data" },
  },
});

const routeRecordUsage = createRoute({
  method: "post", path: "/api/usage/events", tags: ["Usage"],
  summary: "Record a usage event", security: BEARER_AUTH,
  request: { body: { content: { "application/json": { schema: AiUsageObservedSchema } } } },
  responses: {
    201: { content: { "application/json": { schema: UsageEventResponseSchema } }, description: "Usage event recorded" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad request" },
  },
});

const routeMoveUsage = createRoute({
  method: "post", path: "/api/usage/events/{usageId}/move", tags: ["Usage"],
  summary: "Move a usage event to a different task", security: BEARER_AUTH,
  request: {
    params: z.object({ usageId: z.string() }),
    query: WorkspaceQuery,
    body: { content: { "application/json": { schema: z.object({ task_key: z.string(), workspace: z.string().optional() }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: UsageEventResponseSchema } }, description: "Usage event moved" },
  },
});

const routeUsageLastImport = createRoute({
  method: "get", path: "/api/usage/last-import", tags: ["Usage"],
  summary: "Get the occurred_at of the last imported event for a source", security: BEARER_AUTH,
  request: { query: WorkspaceQuery.extend({ source: z.string().default("claude-session") }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ occurred_at: z.string().nullable() }) } }, description: "Last import timestamp" },
  },
});

const routeAssignInboxGroup = createRoute({
  method: "post", path: "/api/inbox/{groupId}/assign", tags: ["Inbox"],
  summary: "Assign an inbox group to a task", security: BEARER_AUTH,
  request: {
    params: z.object({ groupId: z.string() }),
    query: WorkspaceQuery,
    body: { content: { "application/json": { schema: z.object({ task_key: z.string(), all: z.boolean().optional(), workspace: z.string().optional() }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: InboxAssignResultSchema } }, description: "Group assigned" },
  },
});

const routeAcceptInboxGroup = createRoute({
  method: "post", path: "/api/inbox/{groupId}/accept", tags: ["Inbox"],
  summary: "Accept an inbox group using its suggested task", security: BEARER_AUTH,
  request: {
    params: z.object({ groupId: z.string() }),
    query: WorkspaceQuery,
    body: { content: { "application/json": { schema: z.object({ all: z.boolean().optional(), workspace: z.string().optional() }).optional() } } },
  },
  responses: {
    200: { content: { "application/json": { schema: InboxAssignResultSchema } }, description: "Group accepted" },
  },
});

const routeAssignInboxEvent = createRoute({
  method: "post", path: "/api/inbox/events/{usageId}/assign", tags: ["Inbox"],
  summary: "Assign a single inbox event to a task", security: BEARER_AUTH,
  request: {
    params: z.object({ usageId: z.string() }),
    query: WorkspaceQuery,
    body: { content: { "application/json": { schema: z.object({ task_key: z.string(), workspace: z.string().optional() }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: UsageEventResponseSchema } }, description: "Event assigned" },
  },
});

const InboxGroupSchema = z.object({
  group_id: z.string(),
  assignment_status: z.enum(["unassigned", "suggested"]),
  event_count: z.number().int(),
  run_count: z.number().int(),
  token_count: z.number().int(),
  estimated_total: z.number(),
  currency: z.string().nullable(),
  first_occurred_at: z.string(),
  last_occurred_at: z.string(),
  source_context: z.object({
    date_bucket: z.string(),
    tool: z.string().nullable(),
    cwd: z.string().nullable(),
    git_branch: z.string().nullable(),
    command: z.string().nullable(),
    conversation_id: z.string().nullable(),
    request_id: z.string().nullable(),
    external_ref: z.string().nullable(),
  }),
  reason_codes: z.array(z.string()),
  sample_event_ids: z.array(z.string()),
  prompt_samples: z.array(z.string()),
  suggested_task: z.object({
    task_key: z.string(),
    task_name: z.string(),
    confidence: z.number(),
    level: z.enum(["high", "medium", "low"]),
    reason: z.string(),
  }).nullable(),
});

const routeListInboxGroups = createRoute({
  method: "get", path: "/api/inbox/groups", tags: ["Inbox"],
  summary: "List unassigned inbox groups", security: BEARER_AUTH,
  request: { query: WorkspaceQuery.extend({ limit: z.string().optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ groups: z.array(z.unknown()) }) } }, description: "Inbox groups" },
  },
});

const routeListPricingSnapshots = createRoute({
  method: "get", path: "/api/pricing/snapshots", tags: ["Pricing"],
  summary: "List pricing source snapshots", security: BEARER_AUTH,
  responses: {
    200: { content: { "application/json": { schema: z.object({ snapshots: z.array(PricingSourceSnapshotRecordSchema) }) } }, description: "Pricing snapshots" },
  },
});

const routeListPricingRules = createRoute({
  method: "get", path: "/api/pricing/rules", tags: ["Pricing"],
  summary: "List pricing rules for a workspace", security: BEARER_AUTH,
  request: { query: WorkspaceQuery },
  responses: {
    200: { content: { "application/json": { schema: z.object({ rules: z.array(PricingRuleRecordSchema) }) } }, description: "Pricing rules" },
  },
});

// ── App factory ───────────────────────────────────────────────────────────────

export function createHttpApp(options: CreateHttpAppOptions): OpenAPIHono {
  const app = new OpenAPIHono();
  const defaultWorkspaceKey = options.defaultWorkspaceKey ?? "ttoksem-dev";

  // ── System ─────────────────────────────────────────────────────────────────

  app.openapi(routeHealth, (c) => c.json({ ok: true, service: "ttoksem-http" }, 200));

  // ── Workspaces ─────────────────────────────────────────────────────────────

  app.openapi(routeCreateWorkspace, async (c) => {
    const body = c.req.valid("json");
    const workspaceKey = body.key;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse as never;
    const workspace = await options.service.createWorkspace({
      key: workspaceKey,
      name: body.name,
      rootPath: body.root_path,
    });
    return c.json({ workspace }, 201);
  });

  // ── Tasks ──────────────────────────────────────────────────────────────────

  app.openapi(routeStartTask, async (c) => {
    const body = c.req.valid("json");
    const workspaceKey = body.workspace ?? c.req.valid("query").workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse as never;
    const key = body.key;
    const task = await options.service.startTask({
      workspace: workspaceResolver(workspaceKey),
      key,
      name: body.name ?? key,
      description: body.description,
    });
    return c.json({ task }, 201);
  });

  app.openapi(routeUpdateTask, async (c) => {
    const body = c.req.valid("json");
    const workspaceKey = body.workspace ?? c.req.valid("query").workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse as never;
    const update = {
      workspace: workspaceResolver(workspaceKey),
      key: c.req.valid("param").taskKey,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    };
    if (!("name" in update) && !("description" in update)) {
      return c.json({ error: "Bad Request", detail: "Provide name or description." }, 400);
    }
    const task = await options.service.updateTask(update);
    return c.json({ task }, 200);
  });

  app.openapi(routeCloseTask, async (c) => {
    const workspaceKey = c.req.valid("query").workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse as never;
    const task = await options.service.closeTask({
      workspace: workspaceResolver(workspaceKey),
      key: c.req.valid("param").taskKey,
    });
    return c.json({ task }, 200);
  });

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
    try {
      const stats = await options.service.getTaskStats({
        workspace: workspaceResolver(workspaceKey),
        key: c.req.valid("param").taskKey,
      });
      return c.json(stats, 200);
    } catch {
      return c.json({ error: "Task not found" }, 404);
    }
  });

  // ── Dashboard ──────────────────────────────────────────────────────────────

  app.openapi(routeDashboard, async (c) => {
    const q = c.req.valid("query");
    const workspaceKey = q.workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const data = await options.service.dashboard({
      workspace: workspaceResolver(workspaceKey),
      taskLimit: parseLimit(q.taskLimit, 80),
      recentLimit: parseLimit(q.recentLimit, 80),
      dayLimit: parseLimit(q.dayLimit, 30),
      timeZoneOffsetMinutes: parseTimeZoneOffset(q.tzOffsetMinutes),
    });
    return c.json(data, 200);
  });

  app.openapi(routeDashboardTask, async (c) => {
    const q = c.req.valid("query");
    const workspaceKey = q.workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const data = await options.service.dashboardTask({
      workspace: workspaceResolver(workspaceKey),
      taskKey: c.req.valid("param").taskKey,
      recentLimit: parseLimit(q.eventLimit, 150),
      dayLimit: parseLimit(q.dayLimit, 60),
      runLimit: parseLimit(q.runLimit, 150),
      timeZoneOffsetMinutes: parseTimeZoneOffset(q.tzOffsetMinutes),
    });
    return c.json(data, 200);
  });

  // ── Usage ──────────────────────────────────────────────────────────────────

  app.openapi(routeRecordUsage, async (c) => {
    const body = c.req.valid("json");
    const workspaceKey = (typeof body.workspace === "object" && body.workspace !== null && "key" in body.workspace
      ? String(body.workspace.key)
      : undefined) ?? c.req.query("workspace") ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse as never;
    const message = AiUsageObservedSchema.parse({
      ...body,
      workspace: { ...(typeof body.workspace === "object" && body.workspace !== null ? body.workspace : {}), key: workspaceKey },
    });
    const usageEvent = await options.service.recordUsage(message);
    return c.json({ usage_event: usageEvent }, 201);
  });

  app.openapi(routeMoveUsage, async (c) => {
    const body = c.req.valid("json");
    const workspaceKey = body.workspace ?? c.req.valid("query").workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse as never;
    const usageEvent = await options.service.moveUsage({
      workspace: workspaceResolver(workspaceKey),
      usageEventId: c.req.valid("param").usageId,
      taskKey: body.task_key,
    });
    return c.json({ usage_event: usageEvent }, 200);
  });

  app.openapi(routeUsageLastImport, async (c) => {
    const { workspace, source } = c.req.valid("query");
    const workspaceKey = workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const occurred_at = await options.service.getLastImportedAt({ workspace: workspaceResolver(workspaceKey), source });
    return c.json({ occurred_at }, 200);
  });

  // ── Inbox ──────────────────────────────────────────────────────────────────

  app.openapi(routeAssignInboxGroup, async (c) => {
    const body = c.req.valid("json");
    const workspaceKey = body.workspace ?? c.req.valid("query").workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse as never;
    const result = await options.service.assignInboxGroup({
      workspace: workspaceResolver(workspaceKey),
      groupId: c.req.valid("param").groupId,
      taskKey: body.task_key,
      all: body.all,
    });
    return c.json(result, 200);
  });

  app.openapi(routeAcceptInboxGroup, async (c) => {
    const body = c.req.valid("json") ?? {};
    const workspaceKey = (body as Record<string, unknown>).workspace as string | undefined
      ?? c.req.valid("query").workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse as never;
    const result = await options.service.acceptInboxGroup({
      workspace: workspaceResolver(workspaceKey),
      groupId: c.req.valid("param").groupId,
      all: (body as Record<string, unknown>).all as boolean | undefined,
    });
    return c.json(result, 200);
  });

  app.openapi(routeAssignInboxEvent, async (c) => {
    const body = c.req.valid("json");
    const workspaceKey = body.workspace ?? c.req.valid("query").workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse as never;
    const usageEvent = await options.service.assignInboxEvent({
      workspace: workspaceResolver(workspaceKey),
      usageEventId: c.req.valid("param").usageId,
      taskKey: body.task_key,
    });
    return c.json({ usage_event: usageEvent }, 200);
  });

  // ── Inbox groups ──────────────────────────────────────────────────────────

  app.openapi(routeListInboxGroups, async (c) => {
    const { workspace: wk, limit } = c.req.valid("query");
    const workspaceKey = wk ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const groups = await options.service.listInbox({
      workspace: workspaceResolver(workspaceKey),
      limit: limit ? parseLimit(limit, 50) : 50,
    });
    return c.json({ groups }, 200);
  });

  // ── Pricing ────────────────────────────────────────────────────────────────

  app.openapi(routeListPricingSnapshots, async (c) => {
    const authResponse = await authorizeRequest(c, options.auth, defaultWorkspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const snapshots = await options.service.listPricingSourceSnapshots();
    return c.json({ snapshots }, 200);
  });

  app.openapi(routeListPricingRules, async (c) => {
    const { workspace: wk } = c.req.valid("query");
    const workspaceKey = wk ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const rules = await options.service.listPricingRules({
      workspace: workspaceResolver(workspaceKey),
    });
    return c.json({ rules }, 200);
  });

  // ── OpenAPI spec ───────────────────────────────────────────────────────────

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
  });

  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: { title: "ttoksem API", version: "0.0.0" },
    ...(options.serverUrl ? { servers: [{ url: options.serverUrl }] } : {}),
  });

  // ── HTML dashboard ─────────────────────────────────────────────────────────

  app.get("/", (context) => context.html(renderDashboardHtml(defaultWorkspaceKey, null)));
  app.get("/tasks/:taskKey", (context) =>
    context.html(renderDashboardHtml(defaultWorkspaceKey, context.req.param("taskKey"))),
  );

  app.onError((error, context) =>
    context.json(
      { error: error instanceof Error ? error.message : String(error) },
      isRequestValidationError(error) ? 400 : 500,
    ),
  );

  return app;
}

export type HttpApp = ReturnType<typeof createHttpApp>;

function workspaceResolver(workspaceKey: string): WorkspaceResolver {
  return { key: workspaceKey };
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
      { error: "Unauthorized", detail: "Provide a database access key with Authorization: Bearer <token>." },
      401,
    );
  }
  const allowed = await auth.verifyAccessToken({ workspaceKey, token, requiredScopes });
  if (!allowed) {
    return context.json(
      { error: "Forbidden", detail: `Access key is missing required scope: ${requiredScopes.join(",")}.` },
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
