import { Hono } from "hono";
import type { DashboardData, LedgerService, WorkspaceResolver } from "@ttoksem/core";

export interface CreateHttpAppOptions {
  service: LedgerService;
  defaultWorkspaceKey?: string;
}

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
    const data = await options.service.dashboard({
      workspace: workspaceResolver(workspaceKey),
      taskLimit: parseLimit(context.req.query("taskLimit"), 80),
      recentLimit: parseLimit(context.req.query("recentLimit"), 80),
      dayLimit: parseLimit(context.req.query("dayLimit"), 30),
    });
    return context.json(data);
  });

  app.get("/api/tasks/:taskKey", async (context) => {
    const workspaceKey = context.req.query("workspace") ?? defaultWorkspaceKey;
    const data = await options.service.dashboardTask({
      workspace: workspaceResolver(workspaceKey),
      taskKey: context.req.param("taskKey"),
      recentLimit: parseLimit(context.req.query("eventLimit"), 150),
      dayLimit: parseLimit(context.req.query("dayLimit"), 60),
      runLimit: parseLimit(context.req.query("runLimit"), 150),
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

function renderDashboardHtml(defaultWorkspaceKey: string, taskKey: string | null): string {
  const workspaceJson = JSON.stringify(defaultWorkspaceKey);
  const taskKeyJson = JSON.stringify(taskKey);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ttoksem Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --line: #d8dde8;
      --text: #1d2430;
      --muted: #657084;
      --accent: #1b7f6b;
      --accent-2: #2c5f9e;
      --warn: #b45309;
      --bad: #b42318;
      --ok-bg: #e8f5f1;
      --warn-bg: #fff4df;
      --bad-bg: #fdebea;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      letter-spacing: 0;
      min-width: 1180px;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    .wrap {
      width: min(1880px, calc(100% - 40px));
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 60px;
      gap: 16px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.1;
      font-weight: 700;
    }
    .workspace {
      color: var(--muted);
      font-size: 13px;
      margin-top: 4px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    input {
      height: 36px;
      min-width: 180px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 10px;
      color: var(--text);
      background: #fff;
      font-size: 14px;
    }
    button {
      height: 36px;
      border: 1px solid #166d5d;
      background: var(--accent);
      color: #fff;
      border-radius: 6px;
      padding: 0 12px;
      font-weight: 650;
      cursor: pointer;
    }
    main {
      padding: 16px 0 34px;
    }
    .grid {
      display: grid;
      gap: 12px;
    }
    .kpis {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
    .layout {
      grid-template-columns: 330px minmax(0, 1fr) 360px;
      align-items: start;
      margin-top: 12px;
    }
    .overview-primary {
      margin-top: 12px;
    }
    .overview-support {
      grid-template-columns: 360px minmax(0, 1fr);
      align-items: start;
      margin-top: 12px;
    }
    .overview-support > aside:last-child {
      grid-column: 2;
    }
    .detail-layout {
      grid-template-columns: minmax(0, 1fr) 420px;
      align-items: start;
      margin-top: 12px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      min-width: 0;
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }
    h2 {
      margin: 0;
      font-size: 15px;
      line-height: 1.2;
    }
    a {
      color: var(--accent-2);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .page-title {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin: 4px 0 14px;
    }
    .page-title h1 {
      font-size: 24px;
    }
    .title-meta {
      color: var(--muted);
      font-size: 13px;
      margin-top: 5px;
    }
    .kpi {
      min-height: 86px;
      padding: 13px 14px;
    }
    .kpi-label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    .kpi-value {
      margin-top: 8px;
      font-size: 24px;
      line-height: 1.1;
      font-weight: 760;
      white-space: nowrap;
    }
    .kpi-sub {
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
    }
    table {
      width: 100%;
      min-width: 980px;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 13px;
    }
    #taskTable, #recentTable, #taskEventTable, #taskRunTable {
      overflow-x: auto;
    }
    #insightTable {
      overflow-x: auto;
    }
    #insightTable table {
      min-width: 1560px;
    }
    #taskTable table {
      min-width: 680px;
    }
    #recentTable table, #taskEventTable table {
      min-width: 1320px;
    }
    #taskRunTable table {
      min-width: 1230px;
    }
    th, td {
      padding: 9px 10px;
      border-bottom: 1px solid #eef1f6;
      text-align: left;
      vertical-align: middle;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      background: #fbfcfe;
    }
    tr:last-child td { border-bottom: 0; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .task-cell {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      min-width: 0;
    }
    .task-cell span {
      min-width: 0;
      line-height: 1.25;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .bar {
      width: 64px;
      height: 8px;
      border-radius: 999px;
      background: #e7ebf2;
      overflow: hidden;
      flex: 0 0 auto;
    }
    .bar > span {
      display: block;
      height: 100%;
      width: 0;
      background: var(--accent-2);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      height: 22px;
      max-width: 100%;
      padding: 0 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 650;
      background: var(--ok-bg);
      color: var(--accent);
    }
    .pill.warn {
      background: var(--warn-bg);
      color: var(--warn);
    }
    .pill.bad {
      background: var(--bad-bg);
      color: var(--bad);
    }
    .stack {
      display: grid;
      gap: 12px;
    }
    .attention-list {
      display: grid;
      padding: 2px 16px;
    }
    .attention-row {
      display: grid;
      grid-template-columns: 112px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      min-height: 66px;
      border-bottom: 1px solid #eef1f6;
    }
    .attention-row:last-child {
      border-bottom: 0;
    }
    .attention-row .pill {
      justify-self: start;
    }
    .attention-title {
      font-size: 13px;
      font-weight: 740;
    }
    .attention-body {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
    }
    .attention-metric {
      font-size: 18px;
      font-weight: 780;
      white-space: nowrap;
    }
    .task-label,
    .insight-task {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .task-title {
      font-weight: 740;
      line-height: 1.3;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .task-key {
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      line-height: 1.25;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .insight-task strong,
    .insight-task .muted {
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.3;
    }
    .muted {
      color: var(--muted);
    }
    .insight-text {
      white-space: normal;
      line-height: 1.35;
    }
    .signal-list {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 7px;
    }
    .signal {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 0 7px;
      border-radius: 999px;
      background: #edf4ff;
      color: #2c5f9e;
      font-size: 12px;
      font-weight: 650;
    }
    .signal.warn {
      background: var(--warn-bg);
      color: var(--warn);
    }
    .signal.bad {
      background: var(--bad-bg);
      color: var(--bad);
    }
    .prompt-snippet {
      margin-top: 7px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .breakdown {
      display: grid;
      gap: 10px;
      padding: 14px 16px;
    }
    .break-row {
      display: grid;
      grid-template-columns: minmax(92px, 132px) minmax(0, 1fr) 52px;
      gap: 10px;
      align-items: center;
      font-size: 13px;
    }
    .wide-text {
      white-space: normal;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .money-cell,
    .date-cell {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .row-link {
      display: inline-flex;
      max-width: 100%;
      font-weight: 740;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .section-tabs {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .section-tabs a {
      font-size: 13px;
      font-weight: 700;
    }
    .hidden {
      display: none;
    }
    .spark {
      display: grid;
      gap: 12px;
      min-height: 118px;
      padding: 14px 16px 16px;
    }
    .spark .empty {
      padding: 0;
    }
    .daily-summary {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .daily-label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .daily-sub {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.3;
    }
    .daily-total {
      font-size: 18px;
      font-weight: 780;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .daily-bars {
      display: flex;
      align-items: end;
      gap: 4px;
      height: 52px;
    }
    .daily-bars > div {
      flex: 1;
      min-width: 10px;
      background: var(--accent-2);
      border-radius: 3px 3px 0 0;
      opacity: 0.84;
    }
    .daily-bars.single > div {
      flex: 0 0 30px;
    }
    .empty, .error {
      padding: 18px 16px;
      color: var(--muted);
      font-size: 14px;
    }
    .error { color: var(--bad); }
    @media (max-width: 1px) {
      .kpis, .layout { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; flex-direction: column; padding: 14px 0; }
      .toolbar { width: 100%; }
      input { flex: 1; min-width: 0; }
      .kpi-value { font-size: 24px; }
      .attention-row { grid-template-columns: 1fr; gap: 6px; padding: 12px 0; }
      .attention-metric { font-size: 16px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap topbar">
      <div>
        <h1>ttoksem</h1>
        <div class="workspace" id="workspaceLabel"></div>
      </div>
      <form class="toolbar" id="workspaceForm">
        <input id="workspaceInput" name="workspace" autocomplete="off" aria-label="Workspace">
        <button type="submit">Refresh</button>
      </form>
    </div>
  </header>
  <main class="wrap" id="overviewPage">
    <section class="grid kpis" id="kpis"></section>
    <section class="overview-primary">
      <section class="panel">
        <div class="panel-head">
          <h2>Task Insight</h2>
          <div class="section-tabs"><span class="pill" id="insightCount"></span></div>
        </div>
        <div id="insightTable"></div>
      </section>
    </section>
    <section class="grid overview-support">
      <aside class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Needs Attention</h2><span class="pill" id="attentionCount"></span></div>
          <div id="attentionPanel"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Daily Cost</h2><span class="pill" id="dayCount"></span></div>
          <div class="spark" id="dailySpark"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Pricing Mode</h2></div>
          <div class="breakdown" id="pricingBreakdown"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Accuracy</h2></div>
          <div class="breakdown" id="accuracyBreakdown"></div>
        </section>
      </aside>
      <section class="panel">
        <div class="panel-head"><h2>Recent Usage</h2><span class="pill" id="recentCount"></span></div>
        <div id="recentTable"></div>
      </section>
      <aside class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Cost Snapshot</h2><span class="pill" id="taskCount"></span></div>
          <div id="taskTable"></div>
        </section>
      </aside>
    </section>
  </main>
  <main class="wrap hidden" id="taskPage">
    <div class="page-title">
      <div>
        <a id="backLink" href="/">Overview</a>
        <h1 id="taskTitle"></h1>
        <div class="title-meta" id="taskMeta"></div>
      </div>
      <span class="pill" id="taskStatus"></span>
    </div>
    <section class="grid kpis" id="taskKpis"></section>
    <section class="grid detail-layout">
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Task Signal</h2><span class="pill" id="taskSignalCount"></span></div>
          <div id="taskSignalPanel"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Runs</h2><span class="pill" id="taskRunCount"></span></div>
          <div id="taskRunTable"></div>
        </section>
      </div>
      <aside class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Daily Cost</h2><span class="pill" id="taskDayCount"></span></div>
          <div class="spark" id="taskDailySpark"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Provider / Model</h2></div>
          <div class="breakdown" id="taskProviderBreakdown"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Pricing Mode</h2></div>
          <div class="breakdown" id="taskPricingBreakdown"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Accuracy</h2></div>
          <div class="breakdown" id="taskAccuracyBreakdown"></div>
        </section>
      </aside>
    </section>
    <section class="panel" style="margin-top: 12px;">
      <div class="panel-head"><h2>Event Log</h2><span class="pill" id="taskEventCount"></span></div>
      <div id="taskEventTable"></div>
    </section>
  </main>
  <script>
    const defaultWorkspace = ${workspaceJson};
    const initialTaskKey = ${taskKeyJson};
    const workspaceInput = document.getElementById("workspaceInput");
    const workspaceLabel = document.getElementById("workspaceLabel");
    const form = document.getElementById("workspaceForm");
    workspaceInput.value = new URLSearchParams(location.search).get("workspace") || defaultWorkspace;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const workspace = workspaceInput.value.trim() || defaultWorkspace;
      if (initialTaskKey) {
        loadTaskDetail(workspace, initialTaskKey);
      } else {
        loadDashboard(workspace);
      }
    });

    function money(value, currency) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency || "USD",
        minimumFractionDigits: 6,
        maximumFractionDigits: 9,
      }).format(value || 0);
    }
    function integer(value) {
      return new Intl.NumberFormat("en-US").format(value || 0);
    }
    function text(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char]);
    }
    function pillClass(value) {
      if (value === "unpriced" || value === "unassigned") return "warn";
      if (value === "error") return "bad";
      return "";
    }
    function severityClass(value) {
      if (value === "bad") return "bad";
      if (value === "warn") return "warn";
      return "";
    }
    function signalClass(value) {
      if (value === "pricing gap" || value === "inbox") return "bad";
      if (value === "many turns" || value === "single run") return "warn";
      return "";
    }
    function shortDate(value) {
      if (!value) return "-";
      return String(value).replace("T", " ").slice(0, 16);
    }
    function promptSnippet(value) {
      const raw = String(value || "").replace(/\\s+/g, " ").trim();
      if (!raw) return "";
      return raw.length > 140 ? raw.slice(0, 137) + "..." : raw;
    }
    function taskHref(taskKey, workspace) {
      return '/tasks/' + encodeURIComponent(taskKey) + '?workspace=' + encodeURIComponent(workspace);
    }
    function taskTitle(row) {
      return row.task_name || row.task_key || "unassigned";
    }
    function renderTaskLabel(row, workspace) {
      const key = row.task_key || "unassigned";
      const title = taskTitle(row);
      const keyHtml = title === key ? "" : '<span class="task-key">' + text(key) + '</span>';
      if (key === "unassigned") {
        return '<div class="task-label"><strong class="task-title">' + text(title) + '</strong>' + keyHtml + '</div>';
      }
      return '<div class="task-label"><a class="row-link task-title" href="' + text(taskHref(key, workspace)) + '">' + text(title) + '</a>' + keyHtml + '</div>';
    }
    function renderSignals(signals) {
      return (signals || []).map((signal) => '<span class="signal ' + signalClass(signal) + '">' + text(signal) + '</span>').join("");
    }
    function renderKpis(data) {
      const s = data.summary;
      const gapCount = s.unassigned_count + s.unpriced_count;
      document.getElementById("kpis").innerHTML = [
        ["Events", integer(s.event_count), "usage rows"],
        ["Tasks", integer(s.task_count), integer(data.task_insights.length) + " visible"],
        ["Assigned", integer(s.assigned_count) + "/" + integer(s.event_count), "task coverage"],
        ["Unassigned", integer(s.unassigned_count), "inbox rows"],
        ["Attention", integer(data.attention.length), integer(gapCount) + " open gaps"],
        ["Estimated Cost", money(s.estimated_total, s.currency), integer(s.run_count) + " runs"],
      ].map(([label, value, sub]) => '<article class="panel kpi"><div class="kpi-label">' + text(label) + '</div><div class="kpi-value">' + text(value) + '</div><div class="kpi-sub">' + text(sub) + '</div></article>').join("");
    }
    function renderAttention(data) {
      const items = data.attention || [];
      document.getElementById("attentionCount").textContent = integer(items.length);
      document.getElementById("attentionPanel").innerHTML = items.length === 0 ? '<div class="empty">No attention signals.</div>' :
        '<div class="attention-list">' + items.map((item) =>
          '<div class="attention-row"><span class="pill ' + severityClass(item.severity) + '">' + text(item.severity) + '</span><div><div class="attention-title">' + text(item.title) + '</div><div class="attention-body">' + text(item.body) + '</div></div><div class="attention-metric">' + text(item.metric) + '</div></div>'
        ).join("") + '</div>';
    }
    function renderTaskInsights(data, workspace) {
      const rows = data.task_insights || [];
      document.getElementById("insightCount").textContent = integer(rows.length);
      if (rows.length === 0) {
        document.getElementById("insightTable").innerHTML = '<div class="empty">No task insight yet.</div>';
        return;
      }
      document.getElementById("insightTable").innerHTML = '<table><thead><tr><th style="width: 260px;">Task</th><th style="width: 82px;">Status</th><th style="width: 330px;">Insight</th><th style="width: 162px;">Signals</th><th class="num" style="width: 70px;">Turns</th><th class="num" style="width: 64px;">Runs</th><th class="num" style="width: 88px;">Tokens</th><th class="num" style="width: 128px;">Cost</th><th class="num" style="width: 84px;">Unpriced</th><th style="width: 146px;">First</th><th style="width: 146px;">Last</th></tr></thead><tbody>' +
        rows.map((row) => {
          const prompt = promptSnippet(row.latest_prompt);
          const promptHtml = prompt ? '<div class="prompt-snippet">' + text(prompt) + '</div>' : "";
          return '<tr><td>' + renderTaskLabel(row, workspace) + '</td><td><span class="pill ' + pillClass(row.status) + '">' + text(row.status) + '</span></td><td class="wide-text"><div class="insight-text">' + text(row.insight) + '</div>' + promptHtml + '</td><td><div class="signal-list">' + renderSignals(row.signals) + '</div></td><td class="num">' + integer(row.event_count) + '</td><td class="num">' + integer(row.run_count) + '</td><td class="num">' + integer(row.token_count) + '</td><td class="num money-cell">' + text(money(row.estimated_total, data.summary.currency)) + '</td><td class="num">' + integer(row.unpriced_count) + '</td><td class="date-cell">' + text(shortDate(row.first_activity_at)) + '</td><td class="date-cell">' + text(shortDate(row.last_activity_at)) + '</td></tr>';
        }).join("") +
        '</tbody></table>';
    }
    function renderTasks(data, workspace) {
      const max = Math.max(...data.tasks.map((row) => row.estimated_total), 0.000001);
      document.getElementById("taskCount").textContent = integer(data.tasks.length);
      if (data.tasks.length === 0) {
        document.getElementById("taskTable").innerHTML = '<div class="empty">No usage.</div>';
        return;
      }
      document.getElementById("taskTable").innerHTML = '<table><thead><tr><th style="width: 300px;">Task</th><th class="num" style="width: 76px;">Events</th><th class="num" style="width: 96px;">Tokens</th><th class="num" style="width: 128px;">Cost</th><th class="num" style="width: 80px;">Unpriced</th></tr></thead><tbody>' +
        data.tasks.map((row) => {
          const width = Math.max(4, Math.round((row.estimated_total / max) * 100));
          const label = renderTaskLabel(row, workspace);
          return '<tr><td><div class="task-cell"><div class="bar"><span style="width:' + width + '%"></span></div>' + label + '</div></td><td class="num">' + integer(row.event_count) + '</td><td class="num">' + integer(row.token_count) + '</td><td class="num money-cell">' + text(money(row.estimated_total, data.summary.currency)) + '</td><td class="num">' + integer(row.unpriced_count) + '</td></tr>';
        }).join("") +
        '</tbody></table>';
    }
    function renderRecent(data, workspace) {
      document.getElementById("recentCount").textContent = integer(data.recent.length);
      if (data.recent.length === 0) {
        document.getElementById("recentTable").innerHTML = '<div class="empty">No usage.</div>';
        return;
      }
      document.getElementById("recentTable").innerHTML = '<table><thead><tr><th style="width: 170px;">Time</th><th style="width: 240px;">Task</th><th style="width: 220px;">Provider</th><th style="width: 150px;">Kind</th><th class="num" style="width: 96px;">Tokens</th><th class="num" style="width: 128px;">Cost</th><th style="width: 130px;">Confidence</th><th>Prompt</th></tr></thead><tbody>' +
        data.recent.map((row) => {
          const task = renderTaskLabel(row, workspace);
          return '<tr><td class="date-cell">' + text(row.occurred_at.replace("T", " ").slice(0, 19)) + '</td><td>' + task + '</td><td>' + text(row.provider_model) + '</td><td>' + text(row.usage_kind) + '</td><td class="num">' + integer(row.tokens) + '</td><td class="num money-cell">' + text(money(row.cost, row.currency || data.summary.currency)) + '</td><td><span class="pill ' + pillClass(row.confidence) + '">' + text(row.confidence) + '</span></td><td class="wide-text">' + text(promptSnippet(row.prompt) || "-") + '</td></tr>';
        }).join("") +
        '</tbody></table>';
    }
    function renderBreakdown(id, rows, currency) {
      const max = Math.max(...rows.map((row) => row.event_count), 1);
      document.getElementById(id).innerHTML = rows.length === 0 ? '<div class="empty">No data.</div>' :
        rows.map((row) => '<div class="break-row"><span class="pill ' + pillClass(row.key) + '">' + text(row.key) + '</span><div class="bar"><span style="width:' + Math.max(4, Math.round((row.event_count / max) * 100)) + '%"></span></div><span class="num">' + integer(row.event_count) + '</span></div>').join("");
    }
    function renderSpark(data) {
      renderSparkTo("dailySpark", "dayCount", data.daily, data.summary.currency);
    }
    function renderSparkTo(sparkId, countId, rows, currency) {
      const max = Math.max(...rows.map((row) => row.estimated_total), 0.000001);
      document.getElementById(countId).textContent = integer(rows.length) + (rows.length === 1 ? " day" : " days");
      if (rows.length === 0) {
        document.getElementById(sparkId).innerHTML = '<div class="empty">No daily cost data.</div>';
        return;
      }
      const total = rows.reduce((sum, row) => sum + (row.estimated_total || 0), 0);
      const events = rows.reduce((sum, row) => sum + (row.event_count || 0), 0);
      const first = rows[0];
      const last = rows[rows.length - 1];
      const range = rows.length === 1 ? first.date : first.date + " - " + last.date;
      const dayLabel = integer(rows.length) + (rows.length === 1 ? " day" : " days");
      const eventLabel = integer(events) + (events === 1 ? " event" : " events");
      document.getElementById(sparkId).innerHTML =
        '<div class="daily-summary"><div><div class="daily-label">' + text(range) + '</div><div class="daily-sub">' + text(eventLabel + " across " + dayLabel) + '</div></div><div class="daily-total">' + text(money(total, currency)) + '</div></div>' +
        '<div class="daily-bars ' + (rows.length === 1 ? "single" : "") + '">' +
        rows.map((row) => '<div title="' + text(row.date + " " + money(row.estimated_total, currency)) + '" style="height:' + Math.max(6, Math.round((row.estimated_total / max) * 48)) + 'px"></div>').join("") +
        '</div>';
    }
    async function loadDashboard(workspace) {
      workspaceLabel.textContent = workspace;
      const response = await fetch('/api/dashboard?workspace=' + encodeURIComponent(workspace));
      if (!response.ok) {
        document.getElementById("kpis").innerHTML = '<article class="panel error">Dashboard error: ' + text(await response.text()) + '</article>';
        return;
      }
      const data = await response.json();
      renderKpis(data);
      renderAttention(data);
      renderTaskInsights(data, workspace);
      renderTasks(data, workspace);
      renderRecent(data, workspace);
      renderBreakdown("pricingBreakdown", data.pricing_breakdown, data.summary.currency);
      renderBreakdown("accuracyBreakdown", data.accuracy_breakdown, data.summary.currency);
      renderSpark(data);
    }
    function showPage(mode) {
      document.getElementById("overviewPage").classList.toggle("hidden", mode !== "overview");
      document.getElementById("taskPage").classList.toggle("hidden", mode !== "task");
    }
    function detailCurrency(data) {
      const eventWithCurrency = (data.recent || []).find((row) => row.currency);
      return eventWithCurrency ? eventWithCurrency.currency : "USD";
    }
    function renderTaskKpis(data) {
      const insight = data.insight;
      const currency = detailCurrency(data);
      document.getElementById("taskKpis").innerHTML = [
        ["Events", integer(insight.event_count), "usage rows"],
        ["Runs", integer(insight.run_count), integer(data.runs.length) + " visible"],
        ["Tokens", integer(insight.token_count), "tracked usage"],
        ["Estimated Cost", money(insight.estimated_total, currency), "task total"],
        ["Unpriced", integer(insight.unpriced_count), "pricing gaps"],
        ["Last Activity", shortDate(insight.last_activity_at), "latest usage"],
      ].map(([label, value, sub]) => '<article class="panel kpi"><div class="kpi-label">' + text(label) + '</div><div class="kpi-value">' + text(value) + '</div><div class="kpi-sub">' + text(sub) + '</div></article>').join("");
    }
    function renderTaskSignal(data) {
      const insight = data.insight;
      document.getElementById("taskSignalCount").textContent = integer((insight.signals || []).length);
      document.getElementById("taskSignalPanel").innerHTML =
        '<div class="attention-list"><div class="attention-row"><span class="pill ' + pillClass(insight.status) + '">' + text(insight.status) + '</span><div><div class="attention-title">' + text(insight.insight) + '</div><div class="attention-body">' + text(promptSnippet(insight.latest_prompt) || "No prompt snapshot.") + '</div><div class="signal-list">' + renderSignals(insight.signals) + '</div></div><div class="attention-metric">' + text(money(insight.estimated_total, detailCurrency(data))) + '</div></div></div>';
    }
    function renderTaskRuns(data) {
      document.getElementById("taskRunCount").textContent = integer(data.runs.length);
      if (data.runs.length === 0) {
        document.getElementById("taskRunTable").innerHTML = '<div class="empty">No runs.</div>';
        return;
      }
      const currency = detailCurrency(data);
      document.getElementById("taskRunTable").innerHTML = '<table><thead><tr><th style="width: 230px;">Run</th><th style="width: 90px;">Status</th><th style="width: 120px;">Source</th><th class="num" style="width: 88px;">Events</th><th class="num" style="width: 98px;">Tokens</th><th class="num" style="width: 128px;">Cost</th><th style="width: 158px;">Started</th><th style="width: 158px;">First</th><th style="width: 158px;">Last</th></tr></thead><tbody>' +
        data.runs.map((row) => '<tr><td>' + text(row.run_id) + '</td><td><span class="pill ' + pillClass(row.status) + '">' + text(row.status) + '</span></td><td>' + text(row.source) + '</td><td class="num">' + integer(row.event_count) + '</td><td class="num">' + integer(row.token_count) + '</td><td class="num money-cell">' + text(money(row.estimated_total, currency)) + '</td><td class="date-cell">' + text(shortDate(row.started_at)) + '</td><td class="date-cell">' + text(shortDate(row.first_activity_at)) + '</td><td class="date-cell">' + text(shortDate(row.last_activity_at)) + '</td></tr>').join("") +
        '</tbody></table>';
    }
    function renderTaskEvents(data) {
      document.getElementById("taskEventCount").textContent = integer(data.recent.length);
      if (data.recent.length === 0) {
        document.getElementById("taskEventTable").innerHTML = '<div class="empty">No usage events.</div>';
        return;
      }
      const currency = detailCurrency(data);
      document.getElementById("taskEventTable").innerHTML = '<table><thead><tr><th style="width: 170px;">Time</th><th style="width: 230px;">Provider</th><th style="width: 150px;">Kind</th><th class="num" style="width: 96px;">Tokens</th><th class="num" style="width: 128px;">Cost</th><th style="width: 130px;">Confidence</th><th style="width: 130px;">Assignment</th><th>Prompt</th></tr></thead><tbody>' +
        data.recent.map((row) => '<tr><td class="date-cell">' + text(row.occurred_at.replace("T", " ").slice(0, 19)) + '</td><td>' + text(row.provider_model) + '</td><td>' + text(row.usage_kind) + '</td><td class="num">' + integer(row.tokens) + '</td><td class="num money-cell">' + text(money(row.cost, row.currency || currency)) + '</td><td><span class="pill ' + pillClass(row.confidence) + '">' + text(row.confidence) + '</span></td><td><span class="pill ' + pillClass(row.assignment_status) + '">' + text(row.assignment_status) + '</span></td><td class="wide-text">' + text(promptSnippet(row.prompt) || "-") + '</td></tr>').join("") +
        '</tbody></table>';
    }
    async function loadTaskDetail(workspace, taskKey) {
      showPage("task");
      workspaceLabel.textContent = workspace;
      document.getElementById("backLink").href = '/?workspace=' + encodeURIComponent(workspace);
      const response = await fetch('/api/tasks/' + encodeURIComponent(taskKey) + '?workspace=' + encodeURIComponent(workspace));
      if (!response.ok) {
        document.getElementById("taskKpis").innerHTML = '<article class="panel error">Task error: ' + text(await response.text()) + '</article>';
        return;
      }
      const data = await response.json();
      const currency = detailCurrency(data);
      document.title = data.task.name + " · ttoksem";
      document.getElementById("taskTitle").textContent = data.task.name;
      const description = data.task.description ? " · " + data.task.description : "";
      document.getElementById("taskMeta").textContent = data.task.key + description + " · created " + shortDate(data.task.created_at);
      document.getElementById("taskStatus").textContent = data.task.status;
      renderTaskKpis(data);
      renderTaskSignal(data);
      renderTaskRuns(data);
      renderTaskEvents(data);
      renderSparkTo("taskDailySpark", "taskDayCount", data.daily, currency);
      renderBreakdown("taskProviderBreakdown", data.provider_breakdown, currency);
      renderBreakdown("taskPricingBreakdown", data.pricing_breakdown, currency);
      renderBreakdown("taskAccuracyBreakdown", data.accuracy_breakdown, currency);
    }
    if (initialTaskKey) {
      loadTaskDetail(workspaceInput.value, initialTaskKey);
    } else {
      showPage("overview");
      loadDashboard(workspaceInput.value);
    }
  </script>
</body>
</html>`;
}
