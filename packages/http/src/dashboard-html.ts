import type { DashboardData } from "@ttoksem/core";

export function renderDashboardHtml(defaultWorkspaceKey: string, taskKey: string | null): string {
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
      --ink: var(--text);
      --muted: #657084;
      --accent: #1b7f6b;
      --accent-2: #2c5f9e;
      --warn: #b45309;
      --bad: #b42318;
      --ok-bg: #e8f5f1;
      --warn-bg: #fff4df;
      --bad-bg: #fdebea;
      --font-ui: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      --fs-2xs: 10px;
      --fs-xs: 11px;
      --fs-sm: 12px;
      --fs-base: 13px;
      --fs-control: 14px;
      --fs-title: 15px;
      --fs-card: 16px;
      --fs-metric: 18px;
      --fs-kpi: 21px;
      --fs-brand: 22px;
      --fs-total: 26px;
      --lh-tight: 1.15;
      --lh-title: 1.25;
      --lh-copy: 1.35;
      --fw-normal: 400;
      --fw-medium: 600;
      --fw-semibold: 700;
      --fw-bold: 800;
      font-family: var(--font-ui);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-size: var(--fs-base);
      line-height: var(--lh-copy);
      letter-spacing: 0;
      min-width: 1000px;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    .wrap {
      width: min(1680px, calc(100% - 24px));
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
      font-size: var(--fs-brand);
      line-height: var(--lh-tight);
      font-weight: var(--fw-semibold);
    }
    .workspace {
      color: var(--muted);
      font-size: var(--fs-base);
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
      font: inherit;
    }
    button {
      height: 36px;
      border: 1px solid #166d5d;
      background: var(--accent);
      color: #fff;
      border-radius: 6px;
      padding: 0 12px;
      font: inherit;
      font-weight: var(--fw-semibold);
      cursor: pointer;
    }
    button:disabled {
      cursor: default;
      opacity: 0.45;
    }
    main {
      padding: 12px 0 30px;
    }
    .grid {
      display: grid;
      gap: 10px;
    }
    .kpis {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
    .workspace-stage {
      grid-template-columns: minmax(0, 1fr) 300px;
      grid-template-rows: auto auto;
      align-items: stretch;
      margin-top: 10px;
    }
    .workspace-stage > .panel:first-child {
      grid-column: 1;
      grid-row: 1 / span 2;
    }
    .workspace-stage > .panel:nth-child(2) {
      grid-column: 2;
      grid-row: 1;
    }
    .workspace-stage > .panel:nth-child(3) {
      grid-column: 2;
      grid-row: 2;
    }
    .overview-board {
      grid-template-columns: minmax(0, 1fr) 360px;
      grid-template-areas:
        "portfolio cost"
        "insight insight"
        "recent recent";
      align-items: start;
      margin-top: 10px;
    }
    .portfolio-panel {
      grid-area: portfolio;
    }
    .cost-column {
      grid-area: cost;
    }
    .task-insight-panel {
      grid-area: insight;
    }
    .recent-usage-panel {
      grid-area: recent;
    }
    .overview-primary {
      margin-top: 10px;
    }
    .report-board {
      grid-template-columns: minmax(0, 1.05fr) minmax(340px, .95fr);
      grid-template-areas:
        "summary tiles"
        "glance glance";
      margin-top: 10px;
      align-items: start;
    }
    .report-summary-panel {
      grid-area: summary;
    }
    .report-tiles-panel {
      grid-area: tiles;
    }
    .at-a-glance-panel {
      grid-area: glance;
    }
    .report-summary {
      display: grid;
      gap: 10px;
      padding: 14px;
    }
    .report-title {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: start;
      border-bottom: 1px solid #edf1f6;
      padding-bottom: 10px;
    }
    .report-title strong {
      display: block;
      font-size: var(--fs-metric);
      line-height: var(--lh-title);
    }
    .report-title span {
      display: block;
      margin-top: 4px;
      color: var(--muted);
      font-size: var(--fs-sm);
    }
    .summary-lines {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 14px;
    }
    .summary-line {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid #f0f3f8;
      padding-bottom: 7px;
      font-variant-numeric: tabular-nums;
    }
    .summary-line span:first-child {
      color: var(--muted);
      font-weight: var(--fw-semibold);
    }
    .report-tile-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      padding: 14px;
    }
    .report-tile {
      border: 1px solid #edf1f6;
      border-radius: 8px;
      background: #fbfcfe;
      padding: 10px;
      min-width: 0;
    }
    .report-tile h3 {
      margin: 0;
      font-size: var(--fs-base);
      line-height: var(--lh-title);
    }
    .report-tile strong {
      display: block;
      margin-top: 8px;
      font-size: var(--fs-card);
      line-height: var(--lh-title);
      font-variant-numeric: tabular-nums;
    }
    .report-tile small {
      display: block;
      margin-top: 5px;
      color: var(--muted);
      font-size: var(--fs-sm);
      line-height: var(--lh-copy);
    }
    #glanceTable {
      overflow-x: auto;
    }
    #glanceTable table {
      min-width: 1120px;
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
      font-size: var(--fs-title);
      line-height: var(--lh-title);
      font-weight: var(--fw-semibold);
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
      font-size: var(--fs-brand);
    }
    .title-meta {
      color: var(--muted);
      font-size: var(--fs-base);
      margin-top: 5px;
    }
    .kpi {
      min-height: 74px;
      padding: 10px 12px;
    }
    .kpi-label {
      color: var(--muted);
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
      text-transform: uppercase;
    }
    .kpi-value {
      margin-top: 6px;
      font-size: var(--fs-kpi);
      line-height: var(--lh-tight);
      font-weight: var(--fw-bold);
      white-space: nowrap;
    }
    .kpi-sub {
      margin-top: 6px;
      color: var(--muted);
      font-size: var(--fs-base);
    }
    .workspace-pulse {
      display: grid;
      gap: 12px;
      padding: 14px;
    }
    .pulse-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: start;
    }
    .pulse-title {
      font-size: var(--fs-metric);
      font-weight: var(--fw-bold);
      line-height: var(--lh-title);
    }
    .pulse-sub {
      margin-top: 5px;
      color: var(--muted);
      font-size: var(--fs-base);
      line-height: var(--lh-copy);
    }
    .pulse-total {
      text-align: right;
      font-size: var(--fs-total);
      line-height: var(--lh-tight);
      font-weight: var(--fw-bold);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .pulse-total span {
      display: block;
      margin-top: 5px;
      color: var(--muted);
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
      text-transform: uppercase;
    }
    .metric-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 9px;
    }
    .chart-panel {
      display: grid;
      gap: 9px;
      min-width: 0;
      border: 1px solid #edf1f6;
      border-radius: 8px;
      padding: 11px;
      background: #fbfcfe;
    }
    .chart-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
    }
    .chart-title {
      font-size: var(--fs-base);
      font-weight: var(--fw-semibold);
    }
    .chart-sub {
      margin-top: 3px;
      color: var(--muted);
      font-size: var(--fs-sm);
      line-height: var(--lh-copy);
    }
    .chart-total {
      color: var(--ink);
      font-size: var(--fs-metric);
      font-weight: var(--fw-bold);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .chart-svg {
      width: 100%;
      height: auto;
      display: block;
      overflow: visible;
    }
    .chart-grid {
      stroke: #e7ebf2;
      stroke-width: 1;
    }
    .chart-axis {
      fill: var(--muted);
      font-size: var(--fs-2xs);
      font-weight: var(--fw-medium);
    }
    .chart-label {
      fill: var(--ink);
      font-size: var(--fs-xs);
      font-weight: var(--fw-semibold);
    }
    .chart-value {
      fill: var(--muted);
      font-size: var(--fs-xs);
      font-weight: var(--fw-medium);
    }
    .chart-bar {
      fill: var(--accent);
      opacity: .86;
    }
    .chart-bar.soft {
      fill: #9eb8db;
      opacity: .95;
    }
    .chart-bar.hot {
      fill: var(--bad);
      opacity: .88;
    }
    .chart-line {
      fill: none;
      stroke: var(--accent);
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .chart-dot {
      fill: #fff;
      stroke: var(--accent);
      stroke-width: 2;
    }
    .chart-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      color: var(--muted);
      font-size: var(--fs-sm);
    }
    .legend-item {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      white-space: nowrap;
    }
    .legend-swatch {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--accent);
    }
    .legend-swatch.soft {
      background: #9eb8db;
    }
    .chart-empty {
      min-height: 118px;
      display: grid;
      place-items: center;
      color: var(--muted);
      font-size: var(--fs-base);
      border: 1px dashed #d7deea;
      border-radius: 8px;
      background: #fff;
    }
    .portfolio-view {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      align-items: stretch;
      padding: 14px;
    }
    .portfolio-readout {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .readout-card {
      min-width: 0;
      border: 1px solid #edf1f6;
      border-radius: 8px;
      padding: 9px 10px;
      background: #fbfcfe;
    }
    .readout-card span {
      display: block;
      color: var(--muted);
      font-size: var(--fs-xs);
      font-weight: var(--fw-semibold);
      text-transform: uppercase;
    }
    .readout-card strong {
      display: block;
      margin-top: 5px;
      overflow-wrap: anywhere;
      font-size: var(--fs-card);
      line-height: var(--lh-title);
      font-weight: var(--fw-semibold);
    }
    .readout-card small {
      display: block;
      margin-top: 5px;
      color: var(--muted);
      font-size: var(--fs-sm);
      line-height: var(--lh-copy);
    }
    .portfolio-dot {
      fill: var(--accent);
      fill-opacity: .82;
      stroke: #fff;
      stroke-width: 2;
    }
    .portfolio-dot.warn {
      fill: var(--warn);
    }
    .portfolio-dot.bad {
      fill: var(--bad);
    }
    .portfolio-dot.open {
      fill: var(--accent-2);
    }
    .quadrant-label {
      fill: var(--muted);
      font-size: var(--fs-xs);
      font-weight: var(--fw-semibold);
    }
    .work-progress {
      display: grid;
      gap: 12px;
      padding: 14px;
    }
    .lifecycle-list {
      display: grid;
      gap: 10px;
    }
    .lifecycle-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 142px;
      gap: 10px;
      align-items: center;
    }
    .lifecycle-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
    }
    .lifecycle-track {
      position: relative;
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: #e8ecf4;
    }
    .lifecycle-segment {
      position: absolute;
      top: 0;
      height: 100%;
      min-width: 4px;
      border-radius: 999px;
      background: var(--accent);
    }
    .cost-intel {
      display: grid;
      gap: 12px;
      padding: 14px;
    }
    .mix-list {
      display: grid;
      gap: 10px;
    }
    .mix-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
    }
    .mix-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--fs-base);
      font-weight: var(--fw-semibold);
    }
    .mix-meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: var(--fs-sm);
      line-height: var(--lh-copy);
    }
    .mix-cost {
      font-size: var(--fs-base);
      font-weight: var(--fw-bold);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .mix-row .progress-track {
      grid-column: 1 / span 2;
      height: 8px;
    }
    .intel-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .metric-box {
      min-width: 0;
      border: 1px solid #edf1f6;
      border-radius: 8px;
      padding: 10px 11px;
      background: #fbfcfe;
    }
    .metric-label {
      color: var(--muted);
      font-size: var(--fs-xs);
      font-weight: var(--fw-semibold);
      text-transform: uppercase;
    }
    .metric-value {
      margin-top: 5px;
      font-size: var(--fs-metric);
      font-weight: var(--fw-bold);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .metric-sub {
      margin-top: 4px;
      color: var(--muted);
      font-size: var(--fs-sm);
      line-height: var(--lh-copy);
    }
    .progress-track {
      display: flex;
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: #e8ecf4;
    }
    .progress-segment {
      min-width: 0;
      height: 100%;
    }
    .progress-segment.assigned,
    .progress-segment.active {
      background: var(--accent);
    }
    .progress-segment.open {
      background: #2c5f9e;
    }
    .progress-segment.closed {
      background: #8b95a6;
    }
    .progress-segment.unassigned,
    .progress-segment.warn {
      background: var(--warn);
    }
    .progress-segment.gap,
    .progress-segment.bad {
      background: var(--bad);
    }
    .progress-caption {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-top: 7px;
      color: var(--muted);
      font-size: var(--fs-sm);
    }
    .task-flow {
      display: grid;
      gap: 12px;
      padding: 14px;
    }
    .task-flow .metric-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .flow-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px 10px;
      align-items: center;
    }
    .flow-label {
      grid-column: 1 / -1;
      color: var(--muted);
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
      text-transform: uppercase;
    }
    .flow-value {
      font-size: var(--fs-metric);
      font-weight: var(--fw-bold);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .driver-list {
      display: grid;
      gap: 10px;
      padding: 12px 14px 14px;
    }
    #taskTable .driver-list {
      padding-top: 0;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .driver-row {
      display: grid;
      gap: 7px;
      min-width: 0;
      padding-bottom: 10px;
      border-bottom: 1px solid #eef1f6;
    }
    .driver-row:last-child {
      padding-bottom: 0;
      border-bottom: 0;
    }
    .driver-top {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: start;
    }
    .driver-cost {
      font-size: var(--fs-base);
      font-weight: var(--fw-bold);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .driver-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      color: var(--muted);
      font-size: var(--fs-sm);
      line-height: var(--lh-copy);
    }
    .driver-meta span {
      white-space: nowrap;
    }
    .task-driver-report {
      display: grid;
      gap: 12px;
      padding: 14px;
    }
    .task-driver-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      align-items: stretch;
    }
    .top-event-list {
      display: grid;
      gap: 10px;
    }
    .token-split {
      display: flex;
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: #e8ecf4;
    }
    .token-split span {
      display: block;
      min-width: 0;
      height: 100%;
    }
    .token-split .input {
      background: #9eb8db;
    }
    .token-split .output {
      background: var(--accent);
    }
    .mini-table {
      display: grid;
      gap: 8px;
      padding: 14px 16px;
    }
    .mini-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      font-size: var(--fs-base);
    }
    .mini-row strong {
      overflow-wrap: anywhere;
      white-space: normal;
    }
    table {
      width: 100%;
      min-width: 980px;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: var(--fs-base);
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
    #recentTable table {
      min-width: 1320px;
    }
    #taskEventTable table {
      min-width: 1520px;
    }
    #recentTable {
      overflow-x: auto;
    }
    .table-panel th,
    .table-panel td {
      padding-top: 8px;
      padding-bottom: 8px;
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
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
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
      line-height: var(--lh-title);
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
      font-size: var(--fs-sm);
      font-weight: var(--fw-medium);
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
      padding: 0 14px;
    }
    .attention-row {
      display: grid;
      grid-template-columns: 62px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      min-height: 58px;
      border-bottom: 1px solid #eef1f6;
    }
    .attention-row:last-child {
      border-bottom: 0;
    }
    .attention-row .pill {
      justify-self: start;
    }
    .attention-title {
      font-size: var(--fs-base);
      font-weight: var(--fw-semibold);
    }
    .attention-body {
      color: var(--muted);
      font-size: var(--fs-base);
      line-height: var(--lh-copy);
    }
    .attention-metric {
      font-size: var(--fs-metric);
      font-weight: var(--fw-bold);
      white-space: nowrap;
    }
    .task-label,
    .insight-task {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .task-title {
      font-weight: var(--fw-semibold);
      line-height: var(--lh-title);
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .task-key {
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: var(--fs-sm);
      line-height: var(--lh-title);
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .insight-task strong,
    .insight-task .muted {
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: var(--lh-title);
    }
    .muted {
      color: var(--muted);
    }
    .insight-text {
      white-space: normal;
      line-height: var(--lh-copy);
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
      font-size: var(--fs-sm);
      font-weight: var(--fw-medium);
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
      font-size: var(--fs-sm);
      line-height: var(--lh-copy);
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
      font-size: var(--fs-base);
    }
    .wide-text {
      white-space: normal;
      line-height: var(--lh-copy);
      overflow-wrap: anywhere;
    }
    .money-cell,
    .date-cell {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .elapsed-time {
      color: var(--accent-2);
      font-family: var(--font-mono);
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
    }
    .row-link {
      display: inline-flex;
      max-width: 100%;
      font-weight: var(--fw-semibold);
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .section-tabs {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .pager {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .page-range {
      color: var(--muted);
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
      white-space: nowrap;
    }
    .page-button {
      width: 28px;
      height: 28px;
      padding: 0;
      border-color: var(--line);
      background: #fff;
      color: var(--text);
      font-size: var(--fs-base);
      line-height: var(--lh-tight);
    }
    .page-button:not(:disabled):hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .section-tabs a {
      font-size: var(--fs-base);
      font-weight: var(--fw-semibold);
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
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
      text-transform: uppercase;
    }
    .daily-sub {
      margin-top: 4px;
      color: var(--muted);
      font-size: var(--fs-sm);
      line-height: var(--lh-copy);
    }
    .daily-total {
      font-size: var(--fs-metric);
      font-weight: var(--fw-bold);
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
      font-size: var(--fs-control);
    }
    .error { color: var(--bad); }
    @media (max-width: 900px) {
      body { min-width: 900px; }
      .kpis {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .workspace-stage,
      .report-board,
      .overview-board,
      .detail-layout {
        grid-template-columns: 1fr;
      }
      .report-board {
        grid-template-areas:
          "summary"
          "tiles"
          "glance";
      }
      .overview-board {
        grid-template-areas:
          "portfolio"
          "cost"
          "insight"
          "recent";
      }
      .portfolio-view {
        grid-template-columns: 1fr;
      }
      #taskTable .driver-list {
        grid-template-columns: 1fr;
      }
      .workspace-stage > .panel:first-child,
      .workspace-stage > .panel:nth-child(2),
      .workspace-stage > .panel:nth-child(3) {
        grid-column: auto;
        grid-row: auto;
      }
      .portfolio-readout {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    @media (min-width: 1240px) {
      .workspace-stage {
        grid-template-columns: minmax(0, 1fr) 360px;
      }
      .overview-board {
        grid-template-columns: minmax(0, 1fr) 400px;
      }
      .portfolio-view {
        grid-template-columns: minmax(0, 1fr) 280px;
      }
      .portfolio-view > .chart-panel {
        grid-column: 1;
        grid-row: 1;
      }
      .portfolio-readout {
        grid-column: 2;
        grid-row: 1;
        grid-template-columns: 1fr;
        align-content: start;
      }
      #taskTable .driver-list {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      #taskTable .driver-row {
        padding-bottom: 9px;
      }
    }
    @media (min-width: 1500px) {
      .workspace-stage {
        grid-template-columns: minmax(0, 1fr) 400px;
      }
      .overview-board {
        grid-template-columns: minmax(0, 1fr) 450px;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap topbar">
      <div>
        <h1>ttoksem Report Dashboard</h1>
        <div class="workspace" id="workspaceLabel"></div>
      </div>
      <form class="toolbar" id="workspaceForm">
        <input id="workspaceInput" name="workspace" autocomplete="off" aria-label="Workspace">
        <button type="submit">Refresh</button>
      </form>
    </div>
  </header>
  <main class="wrap" id="overviewPage">
    <section class="grid report-board">
      <section class="panel report-summary-panel">
        <div class="panel-head"><h2>Report Summary</h2><span class="pill">event-time</span></div>
        <div id="reportSummary"></div>
      </section>
      <section class="panel report-tiles-panel">
        <div class="panel-head"><h2>Report Tiles</h2><span class="pill" id="reportTileCount"></span></div>
        <div id="reportTiles"></div>
      </section>
      <section class="panel table-panel at-a-glance-panel">
        <div class="panel-head"><h2>At-a-glance Report Table</h2><span class="pill" id="glanceCount"></span></div>
        <div id="glanceTable"></div>
      </section>
    </section>
    <section class="grid kpis overview-primary" id="kpis"></section>
    <section class="grid workspace-stage">
      <section class="panel">
        <div class="panel-head"><h2>Cost Trend</h2><span class="pill" id="pulseState"></span></div>
        <div class="workspace-pulse" id="workspacePulse"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Work Progress Detail</h2><span class="pill" id="flowCount"></span></div>
        <div class="task-flow" id="taskFlow"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Cleanup Queue</h2><span class="pill" id="attentionCount"></span></div>
        <div id="attentionPanel"></div>
      </section>
    </section>
    <section class="grid overview-board">
      <section class="panel portfolio-panel">
        <div class="panel-head"><h2>Task Report Explorer</h2><div class="section-tabs"><span class="pill" id="taskCount"></span><span class="pager" id="taskPager"></span></div></div>
        <div id="taskTable"></div>
      </section>
      <aside class="stack cost-column">
        <section class="panel">
          <div class="panel-head"><h2>Model Cost Breakdown</h2><span class="pill" id="modelCount"></span></div>
          <div id="costIntelligence"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Daily Cost</h2><span class="pill" id="dayCount"></span></div>
          <div class="spark" id="dailySpark"></div>
        </section>
      </aside>
      <section class="panel table-panel task-insight-panel">
        <div class="panel-head">
          <h2>Task Insight Table</h2>
          <div class="section-tabs"><span class="pill" id="insightCount"></span><span class="pager" id="insightPager"></span></div>
        </div>
        <div id="insightTable"></div>
      </section>
      <section class="panel table-panel recent-usage-panel">
        <div class="panel-head"><h2>Usage Event Detail</h2><div class="section-tabs"><span class="pill" id="recentCount"></span><span class="pager" id="recentPager"></span></div></div>
        <div id="recentTable"></div>
      </section>
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
    <section class="panel" style="margin-top: 12px;">
      <div class="panel-head"><h2>Token Driver Report</h2><span class="pill" id="taskDriverCount"></span></div>
      <div class="task-driver-report">
        <div class="task-driver-grid">
          <div id="taskRunDriverChart"></div>
          <div id="taskEventTimelineChart"></div>
        </div>
        <div id="taskTopEvents"></div>
      </div>
    </section>
    <section class="grid detail-layout">
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Task Health</h2><span class="pill" id="taskSignalCount"></span></div>
          <div id="taskSignalPanel"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Run Timeline</h2><span class="pill" id="taskRunCount"></span></div>
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
      <div class="panel-head"><h2>Usage Events</h2><span class="pill" id="taskEventCount"></span></div>
      <div id="taskEventTable"></div>
    </section>
  </main>
  <script>
    const defaultWorkspace = ${workspaceJson};
    const initialTaskKey = ${taskKeyJson};
    const workspaceInput = document.getElementById("workspaceInput");
    const workspaceLabel = document.getElementById("workspaceLabel");
    const form = document.getElementById("workspaceForm");
    const PAGE_SIZE = {
      tasks: 6,
      insights: 8,
      recent: 10,
    };
    const clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
    const clientTimeZoneOffsetMinutes = -new Date().getTimezoneOffset();
    const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const authToken = initAuthToken();
    const dashboardState = {
      data: null,
      workspace: workspaceInput.value,
      pages: {
        tasks: 0,
        insights: 0,
        recent: 0,
      },
    };
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
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("[data-page-key]");
      if (!button || button.disabled || !dashboardState.data) return;
      const key = button.getAttribute("data-page-key");
      const delta = Number(button.getAttribute("data-page-delta") || 0);
      if (!key || !Number.isFinite(delta)) return;
      dashboardState.pages[key] = (dashboardState.pages[key] || 0) + delta;
      if (key === "tasks") renderTasks(dashboardState.data, dashboardState.workspace);
      if (key === "insights") renderTaskInsights(dashboardState.data, dashboardState.workspace);
      if (key === "recent") renderRecent(dashboardState.data, dashboardState.workspace);
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
    function initAuthToken() {
      const params = new URLSearchParams(location.search);
      const token = params.get("token");
      if (token) {
        localStorage.setItem("ttoksemAuthToken", token);
        params.delete("token");
        const nextSearch = params.toString();
        history.replaceState(null, "", location.pathname + (nextSearch ? "?" + nextSearch : "") + location.hash);
        return token;
      }
      return localStorage.getItem("ttoksemAuthToken") || "";
    }
    function authHeaders() {
      return authToken ? { Authorization: "Bearer " + authToken } : {};
    }
    function pagedRows(key, rows, pageSize) {
      const total = rows.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const requested = Number(dashboardState.pages[key] || 0);
      const page = Math.min(Math.max(0, requested), totalPages - 1);
      dashboardState.pages[key] = page;
      const start = total === 0 ? 0 : page * pageSize;
      const end = Math.min(total, start + pageSize);
      return {
        rows: rows.slice(start, end),
        page,
        totalPages,
        start,
        end,
        total,
      };
    }
    function renderPager(id, key, page) {
      const pager = document.getElementById(id);
      if (!pager) return;
      const range = page.total === 0
        ? "0 of 0"
        : integer(page.start + 1) + "-" + integer(page.end) + " of " + integer(page.total);
      pager.innerHTML =
        '<span class="page-range">' + text(range) + '</span>' +
        '<button type="button" class="page-button" data-page-key="' + text(key) + '" data-page-delta="-1" aria-label="Previous page"' + (page.page <= 0 ? " disabled" : "") + '>&lt;</button>' +
        '<button type="button" class="page-button" data-page-key="' + text(key) + '" data-page-delta="1" aria-label="Next page"' + (page.page >= page.totalPages - 1 ? " disabled" : "") + '>&gt;</button>';
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
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return dateTimeFormatter.format(date);
    }
    function elapsedFrom(baseValue, value) {
      if (!baseValue || !value) return "-";
      const baseMs = Date.parse(baseValue);
      const valueMs = Date.parse(value);
      if (!Number.isFinite(baseMs) || !Number.isFinite(valueMs)) return shortDate(value);
      const diffMs = valueMs - baseMs;
      const sign = diffMs < 0 ? "-" : "+";
      const totalMinutes = Math.round(Math.abs(diffMs) / 60000);
      const days = Math.floor(totalMinutes / 1440);
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const minutes = totalMinutes % 60;
      if (days > 0) return sign + days + "d " + hours + "h";
      if (hours > 0) return sign + hours + "h " + String(minutes).padStart(2, "0") + "m";
      return sign + minutes + "m";
    }
    function elapsedTimeCell(baseValue, value) {
      return '<span class="elapsed-time" title="' + text(shortDate(value)) + '">' + text(elapsedFrom(baseValue, value)) + '</span>';
    }
    function runStartTime(row) {
      return row.started_at || row.first_activity_at || row.last_activity_at;
    }
    function promptSnippet(value) {
      const raw = String(value || "").replace(/\\s+/g, " ").trim();
      if (!raw) return "";
      return raw.length > 140 ? raw.slice(0, 137) + "..." : raw;
    }
    function titledText(title, display) {
      const visible = display == null || display === "" ? title : display;
      return '<span title="' + text(title || visible || "") + '">' + text(visible || "") + '</span>';
    }
    function promptPreview(value, fallback) {
      const raw = String(value || "").replace(/\\s+/g, " ").trim();
      return raw ? titledText(raw, promptSnippet(raw)) : text(fallback || "-");
    }
    function promptBlock(value, className) {
      const raw = String(value || "").replace(/\\s+/g, " ").trim();
      return raw ? '<div class="' + text(className) + '" title="' + text(raw) + '">' + text(promptSnippet(raw)) + '</div>' : "";
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
      const keyHtml = title === key ? "" : '<span class="task-key" title="' + text(key) + '">' + text(key) + '</span>';
      if (key === "unassigned") {
        return '<div class="task-label"><strong class="task-title" title="' + text(title) + '">' + text(title) + '</strong>' + keyHtml + '</div>';
      }
      return '<div class="task-label"><a class="row-link task-title" title="' + text(title) + '" href="' + text(taskHref(key, workspace)) + '">' + text(title) + '</a>' + keyHtml + '</div>';
    }
    function renderSignals(signals) {
      return (signals || []).map((signal) => '<span class="signal ' + signalClass(signal) + '">' + text(signal) + '</span>').join("");
    }
    function percent(value, total) {
      if (!total || total <= 0) return 0;
      return Math.round((value / total) * 100);
    }
    function plural(value, singular, pluralValue) {
      return integer(value) + " " + (value === 1 ? singular : (pluralValue || singular + "s"));
    }
    function truncate(value, max) {
      const raw = String(value || "");
      if (raw.length <= max) return raw;
      return raw.slice(0, Math.max(0, max - 3)) + "...";
    }
    function bucketHourLabel(key, compact) {
      const date = key.slice(5, 10);
      const hour = key.slice(11, 13) + ":00";
      return compact ? hour : date + " " + hour;
    }
    function renderUsageMomentumChart(data) {
      const events = (data.recent || [])
        .filter((row) => row.occurred_at)
        .slice()
        .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
      if (events.length === 0) {
        return '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Usage momentum</div><div class="chart-sub">Recent event volume and estimated cost</div></div></div><div class="chart-empty">No recent usage events.</div></div>';
      }
      const bucketMap = new Map();
      events.forEach((row) => {
        const key = String(row.occurred_at).slice(0, 13);
        const current = bucketMap.get(key) || { key, event_count: 0, cost: 0 };
        current.event_count += 1;
        current.cost += Number(row.cost || 0);
        bucketMap.set(key, current);
      });
      const buckets = Array.from(bucketMap.values()).slice(-12);
      const totalCost = buckets.reduce((sum, row) => sum + row.cost, 0);
      const totalEvents = buckets.reduce((sum, row) => sum + row.event_count, 0);
      const maxEvents = Math.max(...buckets.map((row) => row.event_count), 1);
      const maxCost = Math.max(...buckets.map((row) => row.cost), 0.000001);
      const width = 640;
      const height = 176;
      const left = 38;
      const top = 14;
      const right = 18;
      const bottom = 30;
      const plotWidth = width - left - right;
      const plotHeight = height - top - bottom;
      const step = buckets.length > 1 ? plotWidth / (buckets.length - 1) : 0;
      const barWidth = Math.max(9, Math.min(30, plotWidth / Math.max(buckets.length, 1) * 0.46));
      const xAt = (index) => buckets.length === 1 ? left + plotWidth / 2 : left + index * step;
      const eventY = (value) => top + plotHeight - (value / maxEvents) * plotHeight;
      const costY = (value) => top + plotHeight - (value / maxCost) * plotHeight;
      const costPoints = buckets.map((row, index) => xAt(index).toFixed(1) + "," + costY(row.cost).toFixed(1)).join(" ");
      const sameDay = buckets.every((row) => row.key.slice(0, 10) === buckets[0].key.slice(0, 10));
      const grid = [0, 0.5, 1].map((ratio) => {
        const y = top + plotHeight - plotHeight * ratio;
        return '<line class="chart-grid" x1="' + left + '" y1="' + y.toFixed(1) + '" x2="' + (width - right) + '" y2="' + y.toFixed(1) + '"></line>';
      }).join("");
      const bars = buckets.map((row, index) => {
        const x = xAt(index) - barWidth / 2;
        const y = eventY(row.event_count);
        const barHeight = top + plotHeight - y;
        const label = bucketHourLabel(row.key, sameDay) + " · " + plural(row.event_count, "event") + " · " + money(row.cost, data.summary.currency);
        return '<rect class="chart-bar soft" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + Math.max(2, barHeight).toFixed(1) + '" rx="4"><title>' + text(label) + '</title></rect>';
      }).join("");
      const dots = buckets.map((row, index) => '<circle class="chart-dot" cx="' + xAt(index).toFixed(1) + '" cy="' + costY(row.cost).toFixed(1) + '" r="3.7"><title>' + text(money(row.cost, data.summary.currency)) + '</title></circle>').join("");
      const labels = buckets.map((row, index) => {
        if (buckets.length > 7 && index % 2 === 1) return "";
        return '<text class="chart-axis" x="' + xAt(index).toFixed(1) + '" y="' + (height - 11) + '" text-anchor="middle">' + text(bucketHourLabel(row.key, sameDay)) + '</text>';
      }).join("");
      return '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Usage momentum</div><div class="chart-sub">Recent event volume with hourly cost overlay</div></div><div class="chart-total">' + text(money(totalCost, data.summary.currency)) + '</div></div>' +
        '<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Usage momentum chart">' +
          grid +
          '<text class="chart-axis" x="' + (left - 8) + '" y="' + (top + 4) + '" text-anchor="end">' + text(integer(maxEvents)) + '</text>' +
          '<text class="chart-axis" x="' + (left - 8) + '" y="' + (top + plotHeight + 4) + '" text-anchor="end">0</text>' +
          bars +
          '<polyline class="chart-line" points="' + costPoints + '"></polyline>' +
          dots +
          labels +
        '</svg><div class="chart-legend"><span class="legend-item"><span class="legend-swatch soft"></span>' + text(plural(totalEvents, "usage event")) + '</span><span class="legend-item"><span class="legend-swatch"></span>estimated cost</span></div></div>';
    }
    function renderTaskCostChart(data, workspace) {
      const rows = (data.tasks || []).slice(0, 8);
      if (rows.length === 0) {
        return '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Task cost distribution</div><div class="chart-sub">Top task spend by estimated cost</div></div></div><div class="chart-empty">No task cost data.</div></div>';
      }
      const max = Math.max(...rows.map((row) => row.estimated_total || 0), 0.000001);
      const total = data.summary.estimated_total || 0;
      const width = 660;
      const rowHeight = 30;
      const top = 18;
      const left = 188;
      const right = 126;
      const height = top + rows.length * rowHeight + 20;
      const plotWidth = width - left - right;
      const bars = rows.map((row, index) => {
        const y = top + index * rowHeight + 5;
        const barWidth = Math.max(3, ((row.estimated_total || 0) / max) * plotWidth);
        const share = percent(row.estimated_total, total);
        const label = truncate(taskTitle(row), 27);
        const value = money(row.estimated_total, data.summary.currency) + " · " + share + "%";
        const title = taskTitle(row) + " · " + value;
        const labelText = '<text class="chart-label" x="' + (left - 10) + '" y="' + (y + 15) + '" text-anchor="end"><title>' + text(taskTitle(row)) + '</title>' + text(label) + '</text>';
        const linkedLabel = row.task_key && row.task_key !== "unassigned"
          ? '<a href="' + text(taskHref(row.task_key, workspace)) + '">' + labelText + '</a>'
          : labelText;
        return linkedLabel +
          '<rect class="chart-bar" x="' + left + '" y="' + y + '" width="' + barWidth.toFixed(1) + '" height="16" rx="5"><title>' + text(title) + '</title></rect>' +
          '<text class="chart-value" x="' + (left + plotWidth + 10) + '" y="' + (y + 14) + '">' + text(value) + '</text>';
      }).join("");
      const grid = [0.25, 0.5, 0.75, 1].map((ratio) => {
        const x = left + plotWidth * ratio;
        return '<line class="chart-grid" x1="' + x.toFixed(1) + '" y1="' + top + '" x2="' + x.toFixed(1) + '" y2="' + (height - 14) + '"></line>';
      }).join("");
      return '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Task cost distribution</div><div class="chart-sub">Largest task cost drivers, with detail links in labels</div></div><div class="chart-total">' + text(money(total, data.summary.currency)) + '</div></div>' +
        '<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Task cost distribution chart">' + grid + bars + '</svg></div>';
    }
    function portfolioTone(row) {
      const signals = row.signals || [];
      if (signals.includes("pricing gap")) return "warn";
      if (signals.includes("top cost")) return "bad";
      if (signals.includes("many turns")) return "open";
      return "";
    }
    function renderTaskPortfolioChart(data, workspace) {
      const rows = (data.task_insights || [])
        .filter((row) => row.task_key !== "unassigned")
        .slice()
        .sort((a, b) => (b.estimated_total || 0) - (a.estimated_total || 0))
        .slice(0, 22);
      if (rows.length === 0) {
        return '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Task portfolio</div><div class="chart-sub">Cost, turns, and token weight by task</div></div></div><div class="chart-empty">No task portfolio data.</div></div>';
      }
      const width = 860;
      const height = 310;
      const left = 58;
      const top = 24;
      const right = 26;
      const bottom = 42;
      const plotWidth = width - left - right;
      const plotHeight = height - top - bottom;
      const maxCost = Math.max(...rows.map((row) => row.estimated_total || 0), 0.000001);
      const maxTurns = Math.max(...rows.map((row) => row.event_count || 0), 1);
      const maxTokens = Math.max(...rows.map((row) => row.token_count || 0), 1);
      const xAt = (value) => left + (value / maxCost) * plotWidth;
      const yAt = (value) => top + plotHeight - (value / maxTurns) * plotHeight;
      const radiusAt = (value) => 5 + Math.sqrt((value || 0) / maxTokens) * 12;
      const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const x = left + plotWidth * ratio;
        const y = top + plotHeight - plotHeight * ratio;
        return '<line class="chart-grid" x1="' + x.toFixed(1) + '" y1="' + top + '" x2="' + x.toFixed(1) + '" y2="' + (top + plotHeight) + '"></line>' +
          '<line class="chart-grid" x1="' + left + '" y1="' + y.toFixed(1) + '" x2="' + (left + plotWidth) + '" y2="' + y.toFixed(1) + '"></line>';
      }).join("");
      const dots = rows.map((row, index) => {
        const cx = xAt(row.estimated_total || 0);
        const cy = yAt(row.event_count || 0);
        const r = radiusAt(row.token_count || 0);
        const title = taskTitle(row) + " · " + money(row.estimated_total, data.summary.currency) + " · " + plural(row.event_count, "turn") + " · " + integer(row.token_count) + " tokens";
        const circle = '<circle class="portfolio-dot ' + portfolioTone(row) + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '"><title>' + text(title) + '</title></circle>';
        const label = index < 3
          ? '<text class="chart-label" x="' + Math.min(cx + r + 7, width - 180).toFixed(1) + '" y="' + Math.max(top + 13, cy + 4).toFixed(1) + '"><title>' + text(taskTitle(row)) + '</title>' + text(truncate(taskTitle(row), 24)) + '</text>'
          : "";
        return row.task_key
          ? '<a href="' + text(taskHref(row.task_key, workspace)) + '">' + circle + label + '</a>'
          : circle + label;
      }).join("");
      return '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Task portfolio</div><div class="chart-sub">X = cost, Y = turns, bubble = tokens</div></div><div class="chart-total">' + text(plural(rows.length, "task")) + '</div></div>' +
        '<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Task portfolio scatter chart">' +
          grid +
          '<text class="quadrant-label" x="' + (left + 10) + '" y="' + (top + 18) + '">many turns</text>' +
          '<text class="quadrant-label" x="' + (left + plotWidth / 2) + '" y="' + (height - 8) + '" text-anchor="middle">higher cost</text>' +
          '<text class="chart-axis" x="' + left + '" y="' + (top + plotHeight + 18) + '">0</text>' +
          '<text class="chart-axis" x="' + (width - right) + '" y="' + (top + plotHeight + 18) + '" text-anchor="end">' + text(money(maxCost, data.summary.currency)) + '</text>' +
          '<text class="chart-axis" x="' + (left - 10) + '" y="' + (top + 5) + '" text-anchor="end">' + text(integer(maxTurns)) + '</text>' +
          '<text class="chart-axis" x="' + (left - 10) + '" y="' + (top + plotHeight + 4) + '" text-anchor="end">0</text>' +
          dots +
        '</svg><div class="chart-legend"><span class="legend-item"><span class="legend-swatch"></span>normal</span><span class="legend-item"><span class="legend-swatch soft"></span>high-turn</span><span class="legend-item"><span class="legend-swatch" style="background: var(--bad);"></span>top cost</span></div></div>';
    }
    function renderPortfolioReadout(data, workspace) {
      const rows = (data.task_insights || []).filter((row) => row.task_key !== "unassigned");
      const top = rows.slice().sort((a, b) => (b.estimated_total || 0) - (a.estimated_total || 0))[0];
      const highTurn = rows.filter((row) => (row.signals || []).includes("many turns") || row.event_count >= 5);
      const cleanup = (data.summary.unassigned_count || 0) + (data.summary.unpriced_count || 0);
      const topShare = top ? percent(top.estimated_total, data.summary.estimated_total) : 0;
      const topLabel = top ? '<a title="' + text(taskTitle(top)) + '" href="' + text(taskHref(top.task_key, workspace)) + '">' + text(truncate(taskTitle(top), 34)) + '</a>' : "No task";
      return '<div class="portfolio-readout">' +
        '<div class="readout-card"><span>Largest outlier</span><strong>' + topLabel + '</strong><small>' + text(top ? money(top.estimated_total, data.summary.currency) + " · " + topShare + "% of workspace" : "No cost driver yet") + '</small></div>' +
        '<div class="readout-card"><span>Work drag</span><strong>' + text(plural(highTurn.length, "high-turn task")) + '</strong><small>Review scope or split long conversations.</small></div>' +
        '<div class="readout-card"><span>Data hygiene</span><strong>' + text(plural(cleanup, "cleanup item")) + '</strong><small>Unassigned or unpriced rows blocking cleaner insight.</small></div>' +
      '</div>';
    }
    function renderWorkspacePulse(data, workspace) {
      const s = data.summary;
      const unresolved = s.unassigned_count + s.unpriced_count;
      const assignedPct = percent(s.assigned_count, s.event_count);
      const topTask = (data.task_insights || []).find((row) => row.task_key !== "unassigned") || null;
      const topShare = topTask ? percent(topTask.estimated_total, s.estimated_total) : 0;
      const pulseState = document.getElementById("pulseState");
      pulseState.textContent = unresolved > 0 ? plural(unresolved, "gap") : "clear";
      pulseState.className = "pill " + (unresolved > 0 ? "warn" : "");
      const topTaskHtml = topTask
        ? renderTaskLabel(topTask, workspace)
        : '<div class="task-label"><strong class="task-title">No task usage</strong></div>';
      document.getElementById("workspacePulse").innerHTML =
        '<div class="pulse-head"><div><div class="pulse-title">' + text(data.workspace.name || data.workspace.key) + '</div><div class="pulse-sub">' + text(plural(s.task_count, "tracked task") + " · " + plural(s.event_count, "usage event") + " · " + plural(s.run_count, "run")) + '</div></div><div class="pulse-total">' + text(money(s.estimated_total, s.currency)) + '<span>estimated</span></div></div>' +
        '<div><div class="progress-track"><div class="progress-segment assigned" style="width:' + assignedPct + '%"></div><div class="progress-segment unassigned" style="width:' + percent(s.unassigned_count, s.event_count) + '%"></div></div><div class="progress-caption"><span>' + text(assignedPct + "% assigned") + '</span><span>' + text(plural(s.unassigned_count, "inbox event")) + '</span></div></div>' +
        renderUsageMomentumChart(data) +
        '<div class="metric-strip">' +
          '<div class="metric-box"><div class="metric-label">Task coverage</div><div class="metric-value">' + text(integer(s.assigned_count) + "/" + integer(s.event_count)) + '</div><div class="metric-sub">assigned usage</div></div>' +
          '<div class="metric-box"><div class="metric-label">Pricing gaps</div><div class="metric-value">' + text(integer(s.unpriced_count)) + '</div><div class="metric-sub">unpriced usage</div></div>' +
          '<div class="metric-box"><div class="metric-label">Top share</div><div class="metric-value">' + text(topShare + "%") + '</div><div class="metric-sub">largest task cost</div></div>' +
          '<div class="metric-box"><div class="metric-label">Daily rows</div><div class="metric-value">' + text(integer(data.daily.length)) + '</div><div class="metric-sub">cost timeline</div></div>' +
        '</div>' +
        '<div class="driver-row"><div class="driver-top">' + topTaskHtml + '<div class="driver-cost">' + text(topTask ? money(topTask.estimated_total, s.currency) : money(0, s.currency)) + '</div></div><div class="driver-meta"><span>top cost driver</span><span>' + text(topTask ? plural(topTask.event_count, "turn") : "0 turns") + '</span><span>' + text(topTask ? plural(topTask.run_count, "run") : "0 runs") + '</span></div></div>';
    }
    function renderTaskFlow(data) {
      const rows = data.task_insights || [];
      const statusCounts = rows.reduce((acc, row) => {
        const key = row.status || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const activeCount = (statusCounts.active || 0) + (statusCounts.open || 0);
      const closedCount = (statusCounts.closed || 0) + (statusCounts.archived || 0);
      const unknownCount = rows.length - activeCount - closedCount;
      const manyTurns = rows.filter((row) => (row.signals || []).includes("many turns")).length;
      const pricingGaps = rows.filter((row) => (row.signals || []).includes("pricing gap")).length;
      const topCost = rows.filter((row) => (row.signals || []).includes("top cost")).length;
      const datedRows = rows
        .filter((row) => row.task_key !== "unassigned" && row.first_activity_at && row.last_activity_at)
        .slice()
        .sort((a, b) => String(b.last_activity_at).localeCompare(String(a.last_activity_at)))
        .slice(0, 5);
      const minMs = Math.min(...datedRows.map((row) => Date.parse(row.first_activity_at)));
      const maxMs = Math.max(...datedRows.map((row) => Date.parse(row.last_activity_at)));
      const spanMs = Math.max(1, maxMs - minMs);
      const lifecycle = datedRows.length === 0 ? '<div class="empty">No task activity window.</div>' :
        '<div class="lifecycle-list">' + datedRows.map((row) => {
          const start = Math.max(0, Math.round(((Date.parse(row.first_activity_at) - minMs) / spanMs) * 100));
          const end = Math.min(100, Math.round(((Date.parse(row.last_activity_at) - minMs) / spanMs) * 100));
          const width = Math.max(4, end - start);
          return '<div class="lifecycle-row"><div class="lifecycle-title" title="' + text(taskTitle(row)) + '">' + text(truncate(taskTitle(row), 34)) + '</div><div class="lifecycle-track"><div class="lifecycle-segment" style="left:' + start + '%;width:' + width + '%"></div></div></div>';
        }).join("") + '</div>';
      document.getElementById("flowCount").textContent = plural(rows.length, "task");
      document.getElementById("taskFlow").innerHTML =
        '<div class="flow-row"><div class="flow-label">Task status</div><div><div class="progress-track">' +
          '<div class="progress-segment active" style="width:' + percent(activeCount, rows.length) + '%"></div>' +
          '<div class="progress-segment closed" style="width:' + percent(closedCount, rows.length) + '%"></div>' +
          '<div class="progress-segment warn" style="width:' + percent(unknownCount, rows.length) + '%"></div>' +
        '</div><div class="progress-caption"><span>' + text(plural(activeCount, "active/open task", "active/open tasks")) + '</span><span>' + text(plural(closedCount, "closed task", "closed tasks")) + '</span></div></div><div class="flow-value">' + text(integer(rows.length)) + '</div></div>' +
        '<div class="metric-strip">' +
          '<div class="metric-box"><div class="metric-label">High-turn</div><div class="metric-value">' + text(integer(manyTurns)) + '</div><div class="metric-sub">drift check</div></div>' +
          '<div class="metric-box"><div class="metric-label">Top cost</div><div class="metric-value">' + text(integer(topCost)) + '</div><div class="metric-sub">cost driver</div></div>' +
          '<div class="metric-box"><div class="metric-label">Pricing</div><div class="metric-value">' + text(integer(pricingGaps)) + '</div><div class="metric-sub">gaps</div></div>' +
          '<div class="metric-box"><div class="metric-label">Inbox</div><div class="metric-value">' + text(integer(data.summary.unassigned_count)) + '</div><div class="metric-sub">usage rows</div></div>' +
        '</div><div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Recent task windows</div><div class="chart-sub">First to last activity for visible tasks</div></div></div>' + lifecycle + '</div>';
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
    function renderReportSummary(data) {
      const s = data.summary;
      const warnings = [];
      if (s.unpriced_count > 0) warnings.push(integer(s.unpriced_count) + " unpriced usage rows");
      if (s.unassigned_count > 0) warnings.push(integer(s.unassigned_count) + " unassigned usage rows");
      if (!s.currency && s.event_count > 0) warnings.push("mixed or unknown currency");
      const warningHtml = warnings.length === 0
        ? '<span class="pill">clear</span>'
        : warnings.map((warning) => '<span class="pill warn">' + text(warning) + '</span>').join("");
      document.getElementById("reportSummary").innerHTML =
        '<div class="report-summary">' +
          '<div class="report-title"><div><strong>Workspace dashboard: ' + text(data.workspace.key) + '</strong><span>Cost basis: event_time_estimate · Pricing basis: event-time records</span></div><div>' + warningHtml + '</div></div>' +
          '<div class="summary-lines">' +
            summaryLine("Estimated total", money(s.estimated_total, s.currency)) +
            summaryLine("Provider observed", money(s.observed_total, s.currency)) +
            summaryLine("Usage events", integer(s.event_count)) +
            summaryLine("Tasks / runs", integer(s.task_count) + " / " + integer(s.run_count)) +
            summaryLine("Assigned usage", integer(s.assigned_count) + "/" + integer(s.event_count)) +
            summaryLine("Unassigned usage", integer(s.unassigned_count)) +
            summaryLine("Unpriced usage", integer(s.unpriced_count)) +
            summaryLine("Visible report rows", integer((data.task_insights || []).length + (data.recent || []).length)) +
          '</div>' +
          renderQualityBars(data) +
        '</div>';
    }
    function summaryLine(label, value) {
      return '<div class="summary-line"><span>' + text(label) + '</span><strong>' + text(value) + '</strong></div>';
    }
    function renderQualityBars(data) {
      const s = data.summary;
      const max = Math.max(s.event_count, 1);
      const estimatedOnly = Math.max(0, s.event_count - s.unpriced_count);
      const rows = [
        ["observed", s.observed_total > 0 ? s.event_count - s.unpriced_count : 0, money(s.observed_total, s.currency), ""],
        ["priced", estimatedOnly, integer(estimatedOnly) + " events", ""],
        ["unpriced", s.unpriced_count, integer(s.unpriced_count) + " events", "warn"],
        ["unassigned", s.unassigned_count, integer(s.unassigned_count) + " events", "warn"],
      ];
      return '<div class="driver-list">' + rows.map(([label, value, valueText, tone]) =>
        '<div class="driver-row"><div class="driver-top"><strong>' + text(label) + '</strong><div class="driver-cost">' + text(valueText) + '</div></div><div class="progress-track"><div class="progress-segment ' + (tone || "assigned") + '" style="width:' + Math.max(0, percent(Number(value), max)) + '%"></div></div></div>'
      ).join("") + '</div>';
    }
    function renderReportTiles(data, workspace) {
      const s = data.summary;
      const topTask = (data.task_insights || []).find((row) => row.task_key !== "unassigned");
      const topModel = topRecentModel(data);
      const tiles = [
        {
          title: "Workspace daily cost",
          metric: money(s.estimated_total, s.currency),
          detail: integer(data.daily.length) + " daily buckets · " + integer(s.event_count) + " events",
          href: "#dailySpark",
        },
        {
          title: "Task cost summary",
          metric: topTask ? money(topTask.estimated_total, s.currency) : "No task cost",
          detail: topTask ? taskTitle(topTask) : "No assigned task usage",
          href: topTask ? taskHref(topTask.task_key, workspace) : "#taskTable",
        },
        {
          title: "Model cost breakdown",
          metric: topModel ? topModel.key : "No model rows",
          detail: topModel ? money(topModel.cost, s.currency) + " · " + integer(topModel.events) + " events" : "No recent usage",
          href: "#costIntelligence",
        },
        {
          title: "Data quality",
          metric: integer(s.unpriced_count + s.unassigned_count) + " gaps",
          detail: integer(s.unpriced_count) + " unpriced · " + integer(s.unassigned_count) + " unassigned",
          href: "#attentionPanel",
        },
      ];
      document.getElementById("reportTileCount").textContent = integer(tiles.length);
      document.getElementById("reportTiles").innerHTML = '<div class="report-tile-grid">' + tiles.map((tile) =>
        '<a class="report-tile" href="' + text(tile.href) + '"><h3>' + text(tile.title) + '</h3><strong>' + text(tile.metric) + '</strong><small>' + text(tile.detail) + '</small></a>'
      ).join("") + '</div>';
    }
    function renderAtAGlanceTable(data, workspace) {
      const rows = (data.task_insights || []).slice(0, 8);
      document.getElementById("glanceCount").textContent = rows.length === 0 ? "0 rows" : plural(rows.length, "row");
      if (rows.length === 0) {
        document.getElementById("glanceTable").innerHTML = '<div class="empty">No report rows yet.</div>';
        return;
      }
      const total = data.summary.estimated_total || 0;
      document.getElementById("glanceTable").innerHTML = '<table><thead><tr><th style="width: 270px;">Report item</th><th class="num" style="width: 128px;">Cost</th><th class="num" style="width: 82px;">Share</th><th class="num" style="width: 82px;">Events</th><th class="num" style="width: 74px;">Runs</th><th style="width: 180px;">Priced / unpriced</th><th class="num" style="width: 92px;">Tokens</th><th>Reading</th></tr></thead><tbody>' +
        rows.map((row) => {
          const priced = Math.max(0, row.event_count - row.unpriced_count);
          const reading = (row.signals || []).length > 0 ? row.signals.join(", ") : row.insight;
          return '<tr><td>' + renderTaskLabel(row, workspace) + '</td><td class="num money-cell">' + text(money(row.estimated_total, data.summary.currency)) + '</td><td class="num">' + text(percent(row.estimated_total, total) + "%") + '</td><td class="num">' + integer(row.event_count) + '</td><td class="num">' + integer(row.run_count) + '</td><td>' + text(integer(priced) + " priced / " + integer(row.unpriced_count) + " unpriced") + '</td><td class="num">' + integer(row.token_count) + '</td><td class="wide-text">' + text(reading) + '</td></tr>';
        }).join("") +
        '</tbody></table>';
    }
    function topRecentModel(data) {
      const byModel = new Map();
      (data.recent || []).forEach((row) => {
        const key = row.provider_model || "unknown";
        const current = byModel.get(key) || { key, cost: 0, events: 0 };
        current.cost += Number(row.cost || 0);
        current.events += 1;
        byModel.set(key, current);
      });
      return Array.from(byModel.values()).sort((a, b) => b.cost - a.cost)[0] || null;
    }
    function renderAttention(data, workspace) {
      const items = data.attention || [];
      document.getElementById("attentionCount").textContent = integer(items.length);
      document.getElementById("attentionPanel").innerHTML = items.length === 0 ? '<div class="empty">No attention signals.</div>' :
        '<div class="attention-list">' + items.map((item) =>
          '<div class="attention-row"><span class="pill ' + severityClass(item.severity) + '">' + text(item.severity) + '</span><div><div class="attention-title">' + (item.task_key ? '<a href="' + text(taskHref(item.task_key, workspace)) + '">' + text(item.title) + '</a>' : text(item.title)) + '</div><div class="attention-body">' + text(item.body) + '</div></div><div class="attention-metric">' + text(item.metric) + '</div></div>'
        ).join("") + '</div>';
    }
    function renderTaskInsights(data, workspace) {
      const allRows = data.task_insights || [];
      const page = pagedRows("insights", allRows, PAGE_SIZE.insights);
      document.getElementById("insightCount").textContent = integer(allRows.length);
      renderPager("insightPager", "insights", page);
      if (allRows.length === 0) {
        document.getElementById("insightTable").innerHTML = '<div class="empty">No task insight yet.</div>';
        return;
      }
      document.getElementById("insightTable").innerHTML = '<table><thead><tr><th style="width: 260px;">Task</th><th style="width: 82px;">Status</th><th style="width: 330px;">Insight</th><th style="width: 162px;">Signals</th><th class="num" style="width: 70px;">Turns</th><th class="num" style="width: 64px;">Runs</th><th class="num" style="width: 88px;">Tokens</th><th class="num" style="width: 128px;">Cost</th><th class="num" style="width: 84px;">Unpriced</th><th style="width: 146px;">First</th><th style="width: 146px;">Last</th></tr></thead><tbody>' +
        page.rows.map((row) => {
          const promptHtml = promptBlock(row.latest_prompt, "prompt-snippet");
          return '<tr><td>' + renderTaskLabel(row, workspace) + '</td><td><span class="pill ' + pillClass(row.status) + '">' + text(row.status) + '</span></td><td class="wide-text"><div class="insight-text">' + text(row.insight) + '</div>' + promptHtml + '</td><td><div class="signal-list">' + renderSignals(row.signals) + '</div></td><td class="num">' + integer(row.event_count) + '</td><td class="num">' + integer(row.run_count) + '</td><td class="num">' + integer(row.token_count) + '</td><td class="num money-cell">' + text(money(row.estimated_total, data.summary.currency)) + '</td><td class="num">' + integer(row.unpriced_count) + '</td><td class="date-cell">' + text(shortDate(row.first_activity_at)) + '</td><td class="date-cell">' + text(shortDate(row.last_activity_at)) + '</td></tr>';
        }).join("") +
        '</tbody></table>';
    }
    function renderTasks(data, workspace) {
      const max = Math.max(...data.tasks.map((row) => row.estimated_total), 0.000001);
      document.getElementById("taskCount").textContent = integer(data.tasks.length);
      const page = pagedRows("tasks", data.tasks, PAGE_SIZE.tasks);
      renderPager("taskPager", "tasks", page);
      if (data.tasks.length === 0) {
        document.getElementById("taskTable").innerHTML = '<div class="empty">No usage.</div>';
        return;
      }
      document.getElementById("taskTable").innerHTML = '<div class="portfolio-view">' + renderTaskPortfolioChart(data, workspace) + renderPortfolioReadout(data, workspace) + '</div><div class="driver-list">' +
        page.rows.map((row) => {
          const width = Math.max(4, Math.round((row.estimated_total / max) * 100));
          const label = renderTaskLabel(row, workspace);
          const share = percent(row.estimated_total, data.summary.estimated_total);
          return '<div class="driver-row"><div class="driver-top">' + label + '<div class="driver-cost">' + text(money(row.estimated_total, data.summary.currency)) + '</div></div><div class="progress-track"><div class="progress-segment assigned" style="width:' + width + '%"></div></div><div class="driver-meta"><span>' + text(plural(row.event_count, "usage row")) + '</span><span>' + text(integer(row.token_count) + " tokens") + '</span><span>' + text(share + "% of workspace") + '</span><span>' + text(integer(row.unpriced_count) + " unpriced") + '</span></div></div>';
        }).join("") +
        '</div>';
    }
    function renderRecent(data, workspace) {
      const allRows = data.recent || [];
      const page = pagedRows("recent", allRows, PAGE_SIZE.recent);
      document.getElementById("recentCount").textContent = integer(allRows.length);
      renderPager("recentPager", "recent", page);
      if (allRows.length === 0) {
        document.getElementById("recentTable").innerHTML = '<div class="empty">No usage.</div>';
        return;
      }
      document.getElementById("recentTable").innerHTML = '<table><thead><tr><th style="width: 170px;">Time</th><th style="width: 240px;">Task</th><th style="width: 220px;">Provider</th><th style="width: 150px;">Kind</th><th class="num" style="width: 96px;">Tokens</th><th class="num" style="width: 128px;">Cost</th><th style="width: 130px;">Confidence</th><th>Prompt</th></tr></thead><tbody>' +
        page.rows.map((row) => {
          const task = renderTaskLabel(row, workspace);
          return '<tr><td class="date-cell" title="' + text(shortDate(row.occurred_at)) + '">' + text(shortDate(row.occurred_at)) + '</td><td>' + task + '</td><td title="' + text(row.provider_model) + '">' + text(row.provider_model) + '</td><td title="' + text(row.usage_kind) + '">' + text(row.usage_kind) + '</td><td class="num">' + integer(row.tokens) + '</td><td class="num money-cell">' + text(money(row.cost, row.currency || data.summary.currency)) + '</td><td><span class="pill ' + pillClass(row.confidence) + '">' + text(row.confidence) + '</span></td><td class="wide-text">' + promptPreview(row.prompt) + '</td></tr>';
        }).join("") +
        '</tbody></table>';
    }
    function renderBreakdown(id, rows, currency) {
      const max = Math.max(...rows.map((row) => row.event_count), 1);
      document.getElementById(id).innerHTML = rows.length === 0 ? '<div class="empty">No data.</div>' :
        rows.map((row) => '<div class="break-row"><span class="pill ' + pillClass(row.key) + '">' + text(row.key) + '</span><div class="bar"><span style="width:' + Math.max(4, Math.round((row.event_count / max) * 100)) + '%"></span></div><span class="num">' + integer(row.event_count) + '</span></div>').join("");
    }
    function renderCostIntelligence(data) {
      const byModel = new Map();
      (data.recent || []).forEach((row) => {
        const key = row.provider_model || "unknown";
        const current = byModel.get(key) || { key, event_count: 0, token_count: 0, estimated_total: 0 };
        current.event_count += 1;
        current.token_count += Number(row.tokens || 0);
        current.estimated_total += Number(row.cost || 0);
        byModel.set(key, current);
      });
      const models = Array.from(byModel.values()).sort((a, b) => b.estimated_total - a.estimated_total).slice(0, 6);
      const maxCost = Math.max(...models.map((row) => row.estimated_total), 0.000001);
      const modelTotal = models.reduce((sum, row) => sum + row.estimated_total, 0);
      const avgTokens = data.summary.event_count ? Math.round((data.recent || []).reduce((sum, row) => sum + Number(row.tokens || 0), 0) / Math.max(1, (data.recent || []).length)) : 0;
      document.getElementById("modelCount").textContent = models.length === 0 ? "0 models" : plural(models.length, "model");
      const modelRows = models.length === 0 ? '<div class="empty">No model usage.</div>' :
        '<div class="mix-list">' + models.map((row) => {
          const width = Math.max(4, Math.round((row.estimated_total / maxCost) * 100));
          return '<div class="mix-row"><div><div class="mix-title" title="' + text(row.key) + '">' + text(row.key) + '</div><div class="mix-meta">' + text(plural(row.event_count, "request") + " · " + integer(row.token_count) + " tokens") + '</div></div><div class="mix-cost">' + text(money(row.estimated_total, data.summary.currency)) + '</div><div class="progress-track"><div class="progress-segment assigned" style="width:' + width + '%"></div></div></div>';
        }).join("") + '</div>';
      const pricingRows = (data.pricing_breakdown || []).map((row) =>
        '<div class="readout-card"><span>' + text(row.key) + '</span><strong>' + text(plural(row.event_count, "row")) + '</strong><small>' + text(money(row.estimated_total, data.summary.currency)) + '</small></div>'
      ).join("");
      const accuracyRows = (data.accuracy_breakdown || []).map((row) =>
        '<div class="readout-card"><span>' + text(row.key) + '</span><strong>' + text(plural(row.event_count, "row")) + '</strong><small>' + text(money(row.estimated_total, data.summary.currency)) + '</small></div>'
      ).join("");
      document.getElementById("costIntelligence").innerHTML =
        '<div class="cost-intel">' +
          '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Model spend mix</div><div class="chart-sub">Recent usage grouped by provider/model</div></div><div class="chart-total">' + text(money(modelTotal, data.summary.currency)) + '</div></div>' + modelRows + '</div>' +
          '<div class="intel-grid">' +
            '<div class="readout-card"><span>Average tokens</span><strong>' + text(integer(avgTokens)) + '</strong><small>per recent usage event</small></div>' +
            '<div class="readout-card"><span>Cost basis</span><strong>' + text(data.summary.observed_total > 0 ? "observed" : "estimated") + '</strong><small>' + text(data.summary.observed_total > 0 ? money(data.summary.observed_total, data.summary.currency) : "pricing rules") + '</small></div>' +
          '</div>' +
          '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Pricing and accuracy</div><div class="chart-sub">Whether cost is calculated, observed, or estimated</div></div></div><div class="intel-grid">' + (pricingRows || '<div class="empty">No pricing rows.</div>') + (accuracyRows || '<div class="empty">No accuracy rows.</div>') + '</div></div>' +
        '</div>';
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
      workspaceLabel.textContent = workspace + " · " + clientTimeZone;
      const response = await fetch('/api/dashboard?workspace=' + encodeURIComponent(workspace) + '&tzOffsetMinutes=' + encodeURIComponent(String(clientTimeZoneOffsetMinutes)), { headers: authHeaders() });
      if (!response.ok) {
        document.getElementById("kpis").innerHTML = '<article class="panel error">Dashboard error: ' + text(await response.text()) + '</article>';
        return;
      }
      const data = await response.json();
      dashboardState.data = data;
      dashboardState.workspace = workspace;
      dashboardState.pages.tasks = 0;
      dashboardState.pages.insights = 0;
      dashboardState.pages.recent = 0;
      renderWorkspacePulse(data, workspace);
      renderTaskFlow(data);
      renderKpis(data);
      renderReportSummary(data);
      renderReportTiles(data, workspace);
      renderAtAGlanceTable(data, workspace);
      renderAttention(data, workspace);
      renderTaskInsights(data, workspace);
      renderTasks(data, workspace);
      renderRecent(data, workspace);
      renderCostIntelligence(data);
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
        ["Usage", integer(insight.event_count), "events"],
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
        '<div class="attention-list"><div class="attention-row"><span class="pill ' + pillClass(insight.status) + '">' + text(insight.status) + '</span><div><div class="attention-title">' + text(insight.insight) + '</div><div class="attention-body">' + promptPreview(insight.latest_prompt, "No prompt snapshot.") + '</div><div class="signal-list">' + renderSignals(insight.signals) + '</div></div><div class="attention-metric">' + text(money(insight.estimated_total, detailCurrency(data))) + '</div></div></div>';
    }
    function eventTokenTotal(row) {
      return Number(row.total_tokens || row.tokens || 0);
    }
    function runDisplayId(value) {
      const raw = String(value || "no-run");
      const promptMatch = raw.match(/_prompt_(\\d+)_([a-z0-9]+)$/i);
      if (promptMatch) return "prompt " + Number(promptMatch[1]) + " · " + promptMatch[2].slice(0, 6);
      if (raw.length <= 32) return raw;
      return raw.slice(0, 18) + "..." + raw.slice(-8);
    }
    function runLabel(value) {
      const raw = String(value || "no-run");
      return titledText(raw, runDisplayId(raw));
    }
    function tokenSplit(row) {
      const input = Number(row.input_tokens || 0);
      const output = Number(row.output_tokens || 0);
      const total = Math.max(eventTokenTotal(row), input + output, 1);
      const inputWidth = Math.round((input / total) * 100);
      const outputWidth = Math.round((output / total) * 100);
      if (inputWidth + outputWidth === 0) return '<div class="token-split"><span class="input" style="width:100%"></span></div>';
      return '<div class="token-split" title="' + text(integer(input) + " input / " + integer(output) + " output") + '"><span class="input" style="width:' + inputWidth + '%"></span><span class="output" style="width:' + outputWidth + '%"></span></div>';
    }
    function renderTaskRunDriverChart(data) {
      const rows = (data.runs || [])
        .slice()
        .sort((a, b) => Number(b.token_count || 0) - Number(a.token_count || 0) || Number(b.event_count || 0) - Number(a.event_count || 0))
        .slice(0, 8);
      if (rows.length === 0) {
        return '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Run token drivers</div><div class="chart-sub">Run-level token concentration</div></div></div><div class="chart-empty">No run data.</div></div>';
      }
      const currency = detailCurrency(data);
      const totalTokens = rows.reduce((sum, row) => sum + Number(row.token_count || 0), 0);
      const maxTokens = Math.max(...rows.map((row) => Number(row.token_count || 0)), 1);
      const width = 700;
      const rowHeight = 32;
      const top = 18;
      const left = 170;
      const right = 150;
      const height = top + rows.length * rowHeight + 20;
      const plotWidth = width - left - right;
      const grid = [0.25, 0.5, 0.75, 1].map((ratio) => {
        const x = left + plotWidth * ratio;
        return '<line class="chart-grid" x1="' + x.toFixed(1) + '" y1="' + top + '" x2="' + x.toFixed(1) + '" y2="' + (height - 14) + '"></line>';
      }).join("");
      const bars = rows.map((row, index) => {
        const tokens = Number(row.token_count || 0);
        const y = top + index * rowHeight + 6;
        const barWidth = Math.max(3, (tokens / maxTokens) * plotWidth);
        const share = percent(tokens, totalTokens);
        const label = truncate(runDisplayId(row.run_id), 24);
        const value = integer(tokens) + " tokens · " + share + "%";
        const title = String(row.run_id || "no-run") + " · " + plural(row.event_count, "event") + " · " + integer(tokens) + " tokens · " + money(row.estimated_total, currency);
        return '<text class="chart-label" x="' + (left - 10) + '" y="' + (y + 15) + '" text-anchor="end"><title>' + text(title) + '</title>' + text(label) + '</text>' +
          '<rect class="chart-bar" x="' + left + '" y="' + y + '" width="' + barWidth.toFixed(1) + '" height="16" rx="5"><title>' + text(title) + '</title></rect>' +
          '<text class="chart-value" x="' + (left + plotWidth + 10) + '" y="' + (y + 14) + '">' + text(value) + '</text>';
      }).join("");
      return '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Run token drivers</div><div class="chart-sub">Largest runs by token volume</div></div><div class="chart-total">' + text(integer(totalTokens)) + '</div></div>' +
        '<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Run token driver chart">' + grid + bars + '</svg></div>';
    }
    function renderTaskEventTimelineChart(data) {
      const events = (data.recent || [])
        .filter((row) => row.occurred_at)
        .slice()
        .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))
        .slice(-28);
      if (events.length === 0) {
        return '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Event token timeline</div><div class="chart-sub">Event-level token spikes</div></div></div><div class="chart-empty">No usage events.</div></div>';
      }
      const currency = detailCurrency(data);
      const maxTokens = Math.max(...events.map(eventTokenTotal), 1);
      const totalTokens = events.reduce((sum, row) => sum + eventTokenTotal(row), 0);
      const width = 700;
      const height = 220;
      const left = 38;
      const top = 18;
      const right = 18;
      const bottom = 36;
      const plotWidth = width - left - right;
      const plotHeight = height - top - bottom;
      const barWidth = Math.max(5, Math.min(22, plotWidth / Math.max(events.length, 1) * 0.52));
      const step = events.length > 1 ? plotWidth / (events.length - 1) : 0;
      const xAt = (index) => events.length === 1 ? left + plotWidth / 2 : left + index * step;
      const yFor = (tokens) => top + plotHeight - (tokens / maxTokens) * plotHeight;
      const maxEventTokens = Math.max(...events.map(eventTokenTotal), 0);
      const grid = [0, 0.5, 1].map((ratio) => {
        const y = top + plotHeight - plotHeight * ratio;
        return '<line class="chart-grid" x1="' + left + '" y1="' + y.toFixed(1) + '" x2="' + (width - right) + '" y2="' + y.toFixed(1) + '"></line>';
      }).join("");
      const bars = events.map((row, index) => {
        const tokens = eventTokenTotal(row);
        const x = xAt(index) - barWidth / 2;
        const y = yFor(tokens);
        const barHeight = Math.max(2, top + plotHeight - y);
        const output = Math.min(Number(row.output_tokens || 0), tokens);
        const outputHeight = tokens > 0 ? Math.max(0, (output / tokens) * barHeight) : 0;
        const title = shortDate(row.occurred_at) + " · " + integer(tokens) + " tokens · " + String(row.run_id || "no-run") + " · " + money(row.cost, row.currency || currency);
        const tone = tokens === maxEventTokens && maxEventTokens > 0 ? " hot" : " soft";
        const base = '<rect class="chart-bar' + tone + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + barHeight.toFixed(1) + '" rx="4"><title>' + text(title) + '</title></rect>';
        const outputBar = outputHeight > 1
          ? '<rect class="chart-bar" x="' + x.toFixed(1) + '" y="' + (top + plotHeight - outputHeight).toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + outputHeight.toFixed(1) + '" rx="4"><title>' + text(integer(output) + " output tokens") + '</title></rect>'
          : "";
        return base + outputBar;
      }).join("");
      const sameDay = events.every((row) => String(row.occurred_at).slice(0, 10) === String(events[0].occurred_at).slice(0, 10));
      const labels = events.map((row, index) => {
        if (events.length > 10 && index % Math.ceil(events.length / 7) !== 0) return "";
        return '<text class="chart-axis" x="' + xAt(index).toFixed(1) + '" y="' + (height - 12) + '" text-anchor="middle">' + text(bucketHourLabel(String(row.occurred_at).slice(0, 13), sameDay)) + '</text>';
      }).join("");
      return '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Event token timeline</div><div class="chart-sub">Recent events by total tokens, output overlay</div></div><div class="chart-total">' + text(integer(totalTokens)) + '</div></div>' +
        '<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Event token timeline chart">' +
          grid +
          '<text class="chart-axis" x="' + (left - 8) + '" y="' + (top + 4) + '" text-anchor="end">' + text(integer(maxTokens)) + '</text>' +
          '<text class="chart-axis" x="' + (left - 8) + '" y="' + (top + plotHeight + 4) + '" text-anchor="end">0</text>' +
          bars + labels +
        '</svg><div class="chart-legend"><span class="legend-item"><span class="legend-swatch soft"></span>input/other tokens</span><span class="legend-item"><span class="legend-swatch"></span>output tokens</span><span class="legend-item"><span class="legend-swatch" style="background: var(--bad);"></span>largest event</span></div></div>';
    }
    function renderTaskTopEvents(data) {
      const rows = (data.recent || [])
        .slice()
        .sort((a, b) => eventTokenTotal(b) - eventTokenTotal(a) || String(b.occurred_at).localeCompare(String(a.occurred_at)))
        .slice(0, 5);
      if (rows.length === 0) return '<div class="chart-panel"><div class="chart-empty">No high-token events.</div></div>';
      const currency = detailCurrency(data);
      const maxTokens = Math.max(...rows.map(eventTokenTotal), 1);
      return '<div class="chart-panel"><div class="chart-head"><div><div class="chart-title">Top token events</div><div class="chart-sub">Largest recent events with run and prompt context</div></div></div><div class="top-event-list">' +
        rows.map((row) => {
          const tokens = eventTokenTotal(row);
          const width = percent(tokens, maxTokens);
          const prompt = promptSnippet(row.prompt);
          return '<div class="driver-row"><div class="driver-top"><div><strong title="' + text(shortDate(row.occurred_at)) + '">' + text(shortDate(row.occurred_at)) + '</strong><div class="driver-meta"><span>' + runLabel(row.run_id) + '</span><span title="' + text(row.provider_model) + '">' + text(row.provider_model) + '</span><span title="' + text(row.usage_kind) + '">' + text(row.usage_kind) + '</span><span>' + text(integer(row.input_tokens || 0) + " in / " + integer(row.output_tokens || 0) + " out") + '</span></div></div><div class="driver-cost">' + text(integer(tokens) + " tokens") + '</div></div><div class="progress-track"><div class="progress-segment assigned" style="width:' + width + '%"></div></div>' + tokenSplit(row) + '<div class="driver-meta"><span>' + text(money(row.cost, row.currency || currency)) + '</span><span>' + text(row.confidence) + '</span>' + (prompt ? '<span title="' + text(String(row.prompt || "")) + '">' + text(prompt) + '</span>' : "") + '</div></div>';
        }).join("") +
        '</div></div>';
    }
    function renderTaskDriverReport(data) {
      document.getElementById("taskDriverCount").textContent = integer((data.runs || []).length) + " runs / " + integer((data.recent || []).length) + " events";
      document.getElementById("taskRunDriverChart").innerHTML = renderTaskRunDriverChart(data);
      document.getElementById("taskEventTimelineChart").innerHTML = renderTaskEventTimelineChart(data);
      document.getElementById("taskTopEvents").innerHTML = renderTaskTopEvents(data);
    }
    function renderTaskRuns(data) {
      document.getElementById("taskRunCount").textContent = integer(data.runs.length);
      if (data.runs.length === 0) {
        document.getElementById("taskRunTable").innerHTML = '<div class="empty">No runs.</div>';
        return;
      }
      const currency = detailCurrency(data);
      document.getElementById("taskRunTable").innerHTML = '<table><thead><tr><th style="width: 230px;">Run</th><th style="width: 90px;">Status</th><th style="width: 120px;">Source</th><th class="num" style="width: 88px;">Events</th><th class="num" style="width: 98px;">Tokens</th><th class="num" style="width: 128px;">Cost</th><th style="width: 158px;">Started</th><th style="width: 96px;">First +</th><th style="width: 96px;">Last +</th></tr></thead><tbody>' +
        data.runs.map((row) => {
          const start = runStartTime(row);
          return '<tr><td>' + runLabel(row.run_id) + '</td><td><span class="pill ' + pillClass(row.status) + '">' + text(row.status) + '</span></td><td title="' + text(row.source) + '">' + text(row.source) + '</td><td class="num">' + integer(row.event_count) + '</td><td class="num">' + integer(row.token_count) + '</td><td class="num money-cell">' + text(money(row.estimated_total, currency)) + '</td><td class="date-cell" title="' + text(shortDate(start)) + '">' + text(shortDate(start)) + '</td><td class="date-cell">' + elapsedTimeCell(start, row.first_activity_at) + '</td><td class="date-cell">' + elapsedTimeCell(start, row.last_activity_at) + '</td></tr>';
        }).join("") +
        '</tbody></table>';
    }
    function renderTaskEvents(data) {
      document.getElementById("taskEventCount").textContent = integer(data.recent.length);
      if (data.recent.length === 0) {
        document.getElementById("taskEventTable").innerHTML = '<div class="empty">No usage events.</div>';
        return;
      }
      const currency = detailCurrency(data);
      document.getElementById("taskEventTable").innerHTML = '<table><thead><tr><th style="width: 170px;">Time</th><th style="width: 170px;">Run</th><th style="width: 220px;">Provider</th><th style="width: 145px;">Kind</th><th class="num" style="width: 82px;">Input</th><th class="num" style="width: 82px;">Output</th><th class="num" style="width: 92px;">Total</th><th class="num" style="width: 118px;">Cost</th><th style="width: 124px;">Confidence</th><th>Prompt</th></tr></thead><tbody>' +
        data.recent.map((row) => '<tr><td class="date-cell" title="' + text(shortDate(row.occurred_at)) + '">' + text(shortDate(row.occurred_at)) + '</td><td>' + runLabel(row.run_id) + '</td><td title="' + text(row.provider_model) + '">' + text(row.provider_model) + '</td><td title="' + text(row.usage_kind) + '">' + text(row.usage_kind) + '</td><td class="num">' + integer(row.input_tokens || 0) + '</td><td class="num">' + integer(row.output_tokens || 0) + '</td><td class="num">' + integer(row.tokens) + '</td><td class="num money-cell">' + text(money(row.cost, row.currency || currency)) + '</td><td><span class="pill ' + pillClass(row.confidence) + '">' + text(row.confidence) + '</span></td><td class="wide-text">' + promptPreview(row.prompt) + '</td></tr>').join("") +
        '</tbody></table>';
    }
    async function loadTaskDetail(workspace, taskKey) {
      showPage("task");
      workspaceLabel.textContent = workspace + " · " + clientTimeZone;
      document.getElementById("backLink").href = '/?workspace=' + encodeURIComponent(workspace);
      const response = await fetch('/api/tasks/' + encodeURIComponent(taskKey) + '?workspace=' + encodeURIComponent(workspace) + '&tzOffsetMinutes=' + encodeURIComponent(String(clientTimeZoneOffsetMinutes)), { headers: authHeaders() });
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
      renderTaskDriverReport(data);
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
