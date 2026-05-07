import { type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { logger } from "hono/logger";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { renderDashboardHtml, renderLoginHtml } from "./dashboard-html.js";
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
  /** Enable Hono's request logger (METHOD path → status time). Default true. */
  logRequests?: boolean;
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
      /**
       * Look up the granted scopes for a token without requiring a specific
       * scope. Used by /api/me/permissions so the dashboard can gate UI
       * affordances on what the current session can actually do.
       */
      describeAccessToken?(input: {
        workspaceKey: string;
        token: string;
      }): Promise<{ scopes: string[] } | null>;
    };

// ── Shared query params ───────────────────────────────────────────────────────

const WorkspaceQuery = z.object({ workspace: z.string().optional() });
const TaskKeyParam = z.object({ taskKey: z.string() });

// ── Response schemas ──────────────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string(), detail: z.string().optional() });

const WorkspaceResponseSchema = z.object({ workspace: WorkspaceRecordSchema });
const WorkspacesResponseSchema = z.object({ workspaces: z.array(WorkspaceRecordSchema) });
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
const SESSION_COOKIE = "ttoksem_session";

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

const routeListWorkspaces = createRoute({
  method: "get", path: "/api/workspaces", tags: ["Workspaces"],
  summary: "List all workspaces", security: BEARER_AUTH,
  responses: {
    200: { content: { "application/json": { schema: WorkspacesResponseSchema } }, description: "OK" },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Unauthorized" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "Forbidden" },
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
  summary: "Deprecated: use POST /api/tasks/{taskKey}/archive",
  description:
    "Deprecated alias for POST /api/tasks/{taskKey}/archive. Still archives the task and returns the archived record. Emits Deprecation, Sunset, and Link successor-version headers. Will return 410 Gone after the Sunset window.",
  deprecated: true,
  security: BEARER_AUTH,
  request: { params: TaskKeyParam, query: WorkspaceQuery },
  responses: {
    200: { content: { "application/json": { schema: TaskResponseSchema } }, description: "Task archived (close is a deprecated alias for archive)" },
  },
});

const routeArchiveTask = createRoute({
  method: "post", path: "/api/tasks/{taskKey}/archive", tags: ["Tasks"],
  summary: "Archive a task", security: BEARER_AUTH,
  request: { params: TaskKeyParam, query: WorkspaceQuery },
  responses: {
    200: { content: { "application/json": { schema: TaskResponseSchema } }, description: "Task archived" },
  },
});

const routeTaskActive = createRoute({
  method: "get", path: "/api/tasks/active", tags: ["Tasks"],
  summary: "Removed: workspace active task is replaced by TTOKSEM_TASK env var",
  description:
    "Removed in favor of the TTOKSEM_TASK env var (ADR-0010). See MIGRATION.md#active-task. Returns 410 Gone until the endpoint is deleted entirely after the Sunset window.",
  deprecated: true,
  request: { query: WorkspaceQuery },
  responses: {
    410: { content: { "application/json": { schema: ErrorSchema } }, description: "Endpoint removed; use TTOKSEM_TASK env var" },
  },
});

const routeListTasks = createRoute({
  method: "get", path: "/api/tasks", tags: ["Tasks"],
  summary: "List all tasks in the workspace", security: BEARER_AUTH,
  request: { query: WorkspaceQuery },
  responses: {
    200: { content: { "application/json": { schema: z.object({ tasks: z.array(TaskRecordSchema) }) } }, description: "Workspace tasks" },
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

const routeListUnpriced = createRoute({
  method: "get", path: "/api/usage/unpriced", tags: ["Usage"],
  summary: "List usage events that don't have a pricing rule yet", security: BEARER_AUTH,
  request: { query: WorkspaceQuery.extend({ limit: z.string().optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ events: z.array(UsageEventRecordSchema) }) } }, description: "Unpriced usage events" },
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
    body: { content: { "application/json": { schema: z.object({ task_key: z.string(), all: z.boolean().optional(), create_if_missing: z.boolean().optional(), workspace: z.string().optional() }) } } },
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

const routeListInbox = createRoute({
  method: "get", path: "/api/inbox", tags: ["Inbox"],
  summary: "List inbox events (events without an assigned task)", security: BEARER_AUTH,
  request: { query: WorkspaceQuery.extend({ limit: z.string().optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ events: z.array(UsageEventRecordSchema) }) } }, description: "Inbox events" },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Unauthorized" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "Forbidden" },
  },
});

const routeRunActions = createRoute({
  method: "get", path: "/api/runs/{runId}/actions", tags: ["Runs"],
  summary: "List assistant actions reconstructed for a run", security: BEARER_AUTH,
  request: {
    params: z.object({ runId: z.string() }),
    query: WorkspaceQuery,
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ actions: z.array(z.unknown()) }) } }, description: "Run actions" },
  },
});

const routeRunMeta = createRoute({
  method: "get", path: "/api/runs/{runId}/meta", tags: ["Runs"],
  summary: "Resolve which task a run belongs to (deep-link support)", security: BEARER_AUTH,
  request: {
    params: z.object({ runId: z.string() }),
    query: WorkspaceQuery,
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({
      run_id: z.string(), task_key: z.string(), task_name: z.string(),
    }) } }, description: "Run task lookup" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Run not found" },
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

  // ── Middleware ─────────────────────────────────────────────────────────────

  if (options.logRequests !== false) {
    app.use("*", logger());
  }

  // Verbose request/response capture for non-2xx, gated by TTOKSEM_HTTP_DEBUG=1.
  // Default off so normal runs stay quiet; flip the env flag and restart when
  // a 4xx/5xx isn't reproducing locally and the URL alone isn't enough to
  // explain it. Bodies are clipped to keep stderr usable.
  if (process.env.TTOKSEM_HTTP_DEBUG === "1") {
    app.use("*", async (context, next) => {
      const requestBody = await readRequestBodyForDebug(context.req.raw.clone());
      await next();
      const status = context.res.status;
      if (status >= 400) {
        const responseBody = await readResponseBodyForDebug(context.res.clone());
        console.error(
          `[http-debug] ${context.req.method} ${context.req.path} status=${status}` +
            (requestBody ? `\n  req: ${requestBody}` : "") +
            (responseBody ? `\n  res: ${responseBody}` : ""),
        );
      }
    });
  }

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

  app.openapi(routeListWorkspaces, async (c) => {
    const authResponse = await authorizeRequest(c, options.auth, defaultWorkspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const workspaces = await options.service.listWorkspaces();
    return c.json({ workspaces }, 200);
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
    const taskKey = c.req.valid("param").taskKey;
    // Deprecation headers — /close is a deprecated alias for /archive. After
    // Sunset, /close will return 410 Gone, then be removed. Set before the
    // service call so they accompany error responses too.
    c.header("Deprecation", "Thu, 07 May 2026 00:00:00 GMT");
    c.header("Sunset", "Sat, 07 Nov 2026 00:00:00 GMT");
    c.header(
      "Link",
      `</api/tasks/${taskKey}/archive>; rel="successor-version"`,
    );
    const task = await options.service.closeTask({
      workspace: workspaceResolver(workspaceKey),
      key: taskKey,
    });
    return c.json({ task }, 200);
  });

  app.openapi(routeArchiveTask, async (c) => {
    const workspaceKey = c.req.valid("query").workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["api:write"]);
    if (authResponse) return authResponse as never;
    const task = await options.service.archiveTask({
      workspace: workspaceResolver(workspaceKey),
      key: c.req.valid("param").taskKey,
    });
    return c.json({ task }, 200);
  });

  app.openapi(routeTaskActive, async (c) => {
    c.header("Sunset", "Sat, 07 Nov 2026 00:00:00 GMT");
    c.header("Deprecation", "Thu, 07 May 2026 00:00:00 GMT");
    return c.json(
      {
        error: "endpoint_removed",
        detail:
          "Workspace active task is removed (ADR-0010). Use the TTOKSEM_TASK env var instead. See MIGRATION.md#active-task.",
      },
      410,
    );
  });

  app.openapi(routeListTasks, async (c) => {
    const workspaceKey = c.req.valid("query").workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const tasks = await options.service.listTasks({ workspace: workspaceResolver(workspaceKey) });
    return c.json({ tasks }, 200);
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

  app.openapi(routeListUnpriced, async (c) => {
    const query = c.req.valid("query");
    const workspaceKey = query.workspace ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const limit = parseLimit(query.limit, 200);
    const events = await options.service.listUnpricedUsage({
      workspace: workspaceResolver(workspaceKey),
      limit,
    });
    return c.json({ events }, 200);
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
      createIfMissing: body.create_if_missing,
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
    const groups = await options.service.listInboxGroups({
      workspace: workspaceResolver(workspaceKey),
      limit: limit ? parseLimit(limit, 50) : 50,
    });
    return c.json({ groups }, 200);
  });

  app.openapi(routeListInbox, async (c) => {
    const { workspace: wk, limit } = c.req.valid("query");
    const workspaceKey = wk ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const events = await options.service.listInbox({
      workspace: workspaceResolver(workspaceKey),
      limit: limit ? parseLimit(limit, 200) : 200,
    });
    return c.json({ events }, 200);
  });

  // ── Run actions ────────────────────────────────────────────────────────────

  app.openapi(routeRunActions, async (c) => {
    const { workspace: wk } = c.req.valid("query");
    const workspaceKey = wk ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const actions = await options.service.runActions({
      workspace: workspaceResolver(workspaceKey),
      runId: c.req.valid("param").runId,
    });
    return c.json({ actions }, 200);
  });

  app.openapi(routeRunMeta, async (c) => {
    const { workspace: wk } = c.req.valid("query");
    const workspaceKey = wk ?? defaultWorkspaceKey;
    const authResponse = await authorizeRequest(c, options.auth, workspaceKey, ["dashboard:read"]);
    if (authResponse) return authResponse as never;
    const meta = await options.service.runMeta({
      workspace: workspaceResolver(workspaceKey),
      runId: c.req.valid("param").runId,
    });
    if (!meta) return c.json({ error: "Run not found." }, 404);
    return c.json(meta, 200);
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

  // ── HTML dashboard & login ────────────────────────────────────────────────

  async function requireSession(context: Context): Promise<boolean> {
    if (!options.auth || options.auth.mode === "none") return true;
    const token = bearerToken(context) ?? getCookie(context, SESSION_COOKIE);
    if (!token) return false;
    return options.auth.verifyAccessToken({ workspaceKey: defaultWorkspaceKey, token, requiredScopes: ["dashboard:read"] });
  }

  // Returns the granted scopes for the current request's token, or null when
  // there's no token / no auth-mode introspection support. Used to gate UI
  // affordances (assign / accept buttons) on what the user actually has.
  async function describeRequestToken(context: Context): Promise<{ scopes: string[] } | null> {
    if (!options.auth || options.auth.mode === "none") return { scopes: ["*"] };
    const token = bearerToken(context) ?? context.req.query("token") ?? getCookie(context, SESSION_COOKIE);
    if (!token) return null;
    if (!options.auth.describeAccessToken) return null;
    return options.auth.describeAccessToken({ workspaceKey: defaultWorkspaceKey, token });
  }

  app.get("/api/me/permissions", async (context) => {
    if (!(await requireSession(context))) return context.json({ error: "Unauthorized" }, 401);
    const desc = await describeRequestToken(context);
    if (!desc) return context.json({ error: "Token introspection not available" }, 501);
    return context.json({ workspace: defaultWorkspaceKey, scopes: desc.scopes });
  });

  app.get("/login", async (context) => {
    if (await requireSession(context)) return context.redirect("/");
    return context.html(renderLoginHtml(defaultWorkspaceKey));
  });

  app.post("/login", async (context) => {
    if (!options.auth || options.auth.mode === "none") return context.redirect("/");
    const body = await context.req.parseBody();
    const key = (body["key"] as string | undefined)?.trim() ?? "";
    if (!key) return context.html(renderLoginHtml(defaultWorkspaceKey, "Access key is required."), 400);
    const valid = await options.auth.verifyAccessToken({ workspaceKey: defaultWorkspaceKey, token: key, requiredScopes: ["dashboard:read"] });
    if (!valid) return context.html(renderLoginHtml(defaultWorkspaceKey, "Invalid access key. Please try again."), 401);
    setCookie(context, SESSION_COOKIE, key, { httpOnly: true, path: "/", sameSite: "Strict", maxAge: 60 * 60 * 24 * 30 });
    return context.redirect("/");
  });

  // Sign-out: clear the session cookie (Max-Age=0 marks it for deletion). The
  // cookie is httpOnly so JS can't kill it; this route is the only way to
  // cycle a session without manually editing browser cookies. SameSite=Strict
  // already protects against cross-site logout CSRF.
  app.post("/logout", async (context) => {
    setCookie(context, SESSION_COOKIE, "", { httpOnly: true, path: "/", sameSite: "Strict", maxAge: 0 });
    return context.redirect("/login");
  });

  app.get("/", async (context) => {
    if (!(await requireSession(context))) return context.redirect("/login");
    return context.html(renderDashboardHtml(defaultWorkspaceKey, { view: "pro" }));
  });

  app.get("/inbox", async (context) => {
    if (!(await requireSession(context))) return context.redirect("/login");
    return context.html(renderDashboardHtml(defaultWorkspaceKey, { view: "inbox" }));
  });

  app.get("/pricing", async (context) => {
    if (!(await requireSession(context))) return context.redirect("/login");
    return context.html(renderDashboardHtml(defaultWorkspaceKey, { view: "pricing" }));
  });

  app.get("/tasks/:taskKey", async (context) => {
    if (!(await requireSession(context))) return context.redirect("/login");
    return context.html(renderDashboardHtml(defaultWorkspaceKey, { view: "task", taskKey: context.req.param("taskKey") }));
  });

  app.get("/runs/:runId", async (context) => {
    if (!(await requireSession(context))) return context.redirect("/login");
    return context.html(renderDashboardHtml(defaultWorkspaceKey, { view: "run", runId: context.req.param("runId") }));
  });

  app.onError((error, context) => {
    const message = error instanceof Error ? error.message : String(error);
    let status: 400 | 404 | 500 = 500;
    if (isRequestValidationError(error)) status = 400;
    else if (isNotFoundError(error)) status = 404;
    // Always log server errors with the stack — 4xx is usually obvious from the
    // message alone, but 5xx without a stack means we're flying blind. Prefix
    // tags so it's easy to grep in /tmp/ttoksem-dash.log.
    if (status >= 500) {
      const stack = error instanceof Error && error.stack ? error.stack : message;
      console.error(`[error] ${context.req.method} ${context.req.path} status=${status}\n${stack}`);
    } else {
      console.error(`[warn] ${context.req.method} ${context.req.path} status=${status} msg=${message}`);
    }
    return context.json({ error: message }, status);
  });

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

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Service throws "Task not found.", "Task not found: <key>", "Workspace not found.", etc.
  return /\bnot found\b/i.test(error.message);
}

const HTTP_DEBUG_BODY_LIMIT = 2000;

async function readRequestBodyForDebug(request: Request): Promise<string> {
  if (request.method === "GET" || request.method === "HEAD") return "";
  try {
    const text = await request.text();
    if (!text) return "";
    return text.length > HTTP_DEBUG_BODY_LIMIT
      ? text.slice(0, HTTP_DEBUG_BODY_LIMIT) + `…(${text.length - HTTP_DEBUG_BODY_LIMIT} more)`
      : text;
  } catch {
    return "<unreadable>";
  }
}

async function readResponseBodyForDebug(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return "";
    return text.length > HTTP_DEBUG_BODY_LIMIT
      ? text.slice(0, HTTP_DEBUG_BODY_LIMIT) + `…(${text.length - HTTP_DEBUG_BODY_LIMIT} more)`
      : text;
  } catch {
    return "<unreadable>";
  }
}

async function authorizeRequest(
  context: Context,
  auth: HttpAuthOptions | undefined,
  workspaceKey: string,
  requiredScopes: string[],
): Promise<Response | null> {
  if (!auth || auth.mode === "none") return null;
  const token = bearerToken(context) ?? context.req.query("token") ?? getCookie(context, SESSION_COOKIE);
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
