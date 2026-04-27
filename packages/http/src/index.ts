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
      taskLimit: parseLimit(context.req.query("taskLimit"), 20),
      recentLimit: parseLimit(context.req.query("recentLimit"), 30),
      dayLimit: parseLimit(context.req.query("dayLimit"), 14),
    });
    return context.json(data);
  });

  app.get("/", (context) => context.html(renderDashboardHtml(defaultWorkspaceKey)));

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

function renderDashboardHtml(defaultWorkspaceKey: string): string {
  const workspaceJson = JSON.stringify(defaultWorkspaceKey);
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
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    .wrap {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 68px;
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
      padding: 22px 0 40px;
    }
    .grid {
      display: grid;
      gap: 14px;
    }
    .kpis {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .layout {
      grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
      align-items: start;
      margin-top: 14px;
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
    .kpi {
      min-height: 104px;
      padding: 16px;
    }
    .kpi-label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    .kpi-value {
      margin-top: 10px;
      font-size: 28px;
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
      min-width: 720px;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 13px;
    }
    #taskTable, #recentTable {
      overflow-x: auto;
    }
    #insightTable {
      overflow-x: auto;
    }
    #taskTable table {
      min-width: 560px;
    }
    #insightTable table {
      min-width: 920px;
    }
    th, td {
      padding: 10px 12px;
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
      align-items: center;
      gap: 8px;
      min-width: 0;
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
      gap: 14px;
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
    .insight-task {
      display: grid;
      gap: 3px;
      min-width: 0;
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
    }
    .breakdown {
      display: grid;
      gap: 10px;
      padding: 14px 16px;
    }
    .break-row {
      display: grid;
      grid-template-columns: 104px minmax(0, 1fr) 52px;
      gap: 10px;
      align-items: center;
      font-size: 13px;
    }
    .spark {
      display: flex;
      align-items: end;
      gap: 4px;
      height: 74px;
      padding: 14px 16px 16px;
    }
    .spark > div {
      flex: 1;
      min-width: 10px;
      background: var(--accent-2);
      border-radius: 3px 3px 0 0;
      opacity: 0.84;
    }
    .empty, .error {
      padding: 18px 16px;
      color: var(--muted);
      font-size: 14px;
    }
    .error { color: var(--bad); }
    @media (max-width: 900px) {
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
  <main class="wrap">
    <section class="grid kpis" id="kpis"></section>
    <section class="grid layout">
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Needs Attention</h2><span class="pill" id="attentionCount"></span></div>
          <div id="attentionPanel"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Task Insight</h2><span class="pill" id="insightCount"></span></div>
          <div id="insightTable"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Recent Usage</h2><span class="pill" id="recentCount"></span></div>
          <div id="recentTable"></div>
        </section>
      </div>
      <aside class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Cost Snapshot</h2><span class="pill" id="taskCount"></span></div>
          <div id="taskTable"></div>
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
    </section>
  </main>
  <script>
    const defaultWorkspace = ${workspaceJson};
    const workspaceInput = document.getElementById("workspaceInput");
    const workspaceLabel = document.getElementById("workspaceLabel");
    const form = document.getElementById("workspaceForm");
    workspaceInput.value = new URLSearchParams(location.search).get("workspace") || defaultWorkspace;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      loadDashboard(workspaceInput.value.trim() || defaultWorkspace);
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
    function renderKpis(data) {
      const s = data.summary;
      const gapCount = s.unassigned_count + s.unpriced_count;
      document.getElementById("kpis").innerHTML = [
        ["Workload", integer(s.event_count), integer(s.task_count) + " tasks"],
        ["Task Coverage", integer(s.assigned_count) + "/" + integer(s.event_count), "assigned usage"],
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
    function renderTaskInsights(data) {
      const rows = data.task_insights || [];
      document.getElementById("insightCount").textContent = integer(rows.length);
      if (rows.length === 0) {
        document.getElementById("insightTable").innerHTML = '<div class="empty">No task insight yet.</div>';
        return;
      }
      document.getElementById("insightTable").innerHTML = '<table><thead><tr><th>Task</th><th>Insight</th><th class="num">Turns</th><th class="num">Runs</th><th class="num">Cost</th><th>Last</th></tr></thead><tbody>' +
        rows.map((row) => {
          const prompt = promptSnippet(row.latest_prompt);
          const signals = (row.signals || []).map((signal) => '<span class="signal ' + signalClass(signal) + '">' + text(signal) + '</span>').join("");
          return '<tr><td><div class="insight-task"><strong>' + text(row.task_key) + '</strong><span class="muted">' + text(row.task_name) + ' · ' + text(row.status) + '</span></div></td><td class="insight-text"><div>' + text(row.insight) + '</div><div class="signal-list">' + signals + '</div>' + (prompt ? '<div class="prompt-snippet">' + text(prompt) + '</div>' : '') + '</td><td class="num">' + integer(row.event_count) + '</td><td class="num">' + integer(row.run_count) + '</td><td class="num">' + text(money(row.estimated_total, data.summary.currency)) + '</td><td>' + text(shortDate(row.last_activity_at)) + '</td></tr>';
        }).join("") +
        '</tbody></table>';
    }
    function renderTasks(data) {
      const max = Math.max(...data.tasks.map((row) => row.estimated_total), 0.000001);
      document.getElementById("taskCount").textContent = integer(data.tasks.length);
      if (data.tasks.length === 0) {
        document.getElementById("taskTable").innerHTML = '<div class="empty">No usage.</div>';
        return;
      }
      document.getElementById("taskTable").innerHTML = '<table><thead><tr><th>Task</th><th class="num">Events</th><th class="num">Tokens</th><th class="num">Cost</th><th class="num">Unpriced</th></tr></thead><tbody>' +
        data.tasks.map((row) => {
          const width = Math.max(4, Math.round((row.estimated_total / max) * 100));
          return '<tr><td><div class="task-cell"><div class="bar"><span style="width:' + width + '%"></span></div><span>' + text(row.task_key) + '</span></div></td><td class="num">' + integer(row.event_count) + '</td><td class="num">' + integer(row.token_count) + '</td><td class="num">' + text(money(row.estimated_total, data.summary.currency)) + '</td><td class="num">' + integer(row.unpriced_count) + '</td></tr>';
        }).join("") +
        '</tbody></table>';
    }
    function renderRecent(data) {
      document.getElementById("recentCount").textContent = integer(data.recent.length);
      if (data.recent.length === 0) {
        document.getElementById("recentTable").innerHTML = '<div class="empty">No usage.</div>';
        return;
      }
      document.getElementById("recentTable").innerHTML = '<table><thead><tr><th>Time</th><th>Task</th><th>Provider</th><th class="num">Tokens</th><th class="num">Cost</th><th>Confidence</th></tr></thead><tbody>' +
        data.recent.map((row) => '<tr title="' + text(row.prompt || row.id) + '"><td>' + text(row.occurred_at.replace("T", " ").slice(0, 19)) + '</td><td>' + text(row.task_key) + '</td><td>' + text(row.provider_model) + '</td><td class="num">' + integer(row.tokens) + '</td><td class="num">' + text(money(row.cost, row.currency || data.summary.currency)) + '</td><td><span class="pill ' + pillClass(row.confidence) + '">' + text(row.confidence) + '</span></td></tr>').join("") +
        '</tbody></table>';
    }
    function renderBreakdown(id, rows, currency) {
      const max = Math.max(...rows.map((row) => row.event_count), 1);
      document.getElementById(id).innerHTML = rows.length === 0 ? '<div class="empty">No data.</div>' :
        rows.map((row) => '<div class="break-row"><span class="pill ' + pillClass(row.key) + '">' + text(row.key) + '</span><div class="bar"><span style="width:' + Math.max(4, Math.round((row.event_count / max) * 100)) + '%"></span></div><span class="num">' + integer(row.event_count) + '</span></div>').join("");
    }
    function renderSpark(data) {
      const max = Math.max(...data.daily.map((row) => row.estimated_total), 0.000001);
      document.getElementById("dayCount").textContent = integer(data.daily.length);
      document.getElementById("dailySpark").innerHTML = data.daily.length === 0 ? '<div class="empty">No data.</div>' :
        data.daily.map((row) => '<div title="' + text(row.date + " " + money(row.estimated_total, data.summary.currency)) + '" style="height:' + Math.max(6, Math.round((row.estimated_total / max) * 64)) + 'px"></div>').join("");
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
      renderTaskInsights(data);
      renderTasks(data);
      renderRecent(data);
      renderBreakdown("pricingBreakdown", data.pricing_breakdown, data.summary.currency);
      renderBreakdown("accuracyBreakdown", data.accuracy_breakdown, data.summary.currency);
      renderSpark(data);
    }
    loadDashboard(workspaceInput.value);
  </script>
</body>
</html>`;
}
