/**
 * dsh-token-insights — browser half.
 *
 * A hand-written module in the `window.__ModuleLoader__.load({ id, factory })` shape every DeepSeek Harness client half
 * uses (no ESM syntax). It requires only `react` and the shared UI primitives, and reads its figures from the host
 * through the `tokenInsights` Remote namespace.
 *
 * It contributes one tab beside Chat / Trajectory (`conversation.view`): the token usage of every model call DeepSeek Harness
 * logged — totals, composition, a calendar of daily usage, the trend, providers and their models, and the hours of
 * the day. Display only. The page follows DeepSeek Harness's conversation content width and its theme; every colour
 * is one hue (DeepSeek Harness's own blue scale), by depth.
 */
window.__ModuleLoader__.load({
  id: "dsh-token-insights",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const P = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;
    const { useEffect, useLayoutEffect, useMemo, useRef, useState } = React;

    const NS = "token-insights";
    /** The figures are re-read this often while the tab is open and the window visible. */
    const POLL_MS = 10_000;
    /** …and this often while the history import runs. */
    const IMPORT_POLL_MS = 2_500;
    /** Ranges, in the order the page offers them. */
    const RANGES = ["today", "7d", "30d", "90d", "all"];
    /** Longer ranges than this are drawn by week in the trend. */
    const DAILY_BARS_MAX = 92;
    /** Weeks the calendar shows at most (it shows fewer when narrow). */
    const HEAT_WEEKS = 53;
    /** Per-viewer conveniences (the chosen range and trend mode), kept in this browser only. */
    const PREFS_KEY = "dsh-token-insights:prefs";

    const DICTS = {
      en: {
        "lang": "en-US",
        "tab.label": "Usage",
        "title": "Token usage",
        "live": "Live",
        "liveTip": "Counted from DeepSeek Harness's session logs as each model call finishes\nSubagent sessions, compaction and billed failed calls included",
        "importing": "Importing history {done} / {total}",
        "importTip": "Reading the existing sessions once; later launches read only the sessions that changed",
        "writeFailed": "The usage records could not be saved; retrying automatically",
        "range.label": "Range",
        "range.today": "Today",
        "range.7d": "7 days",
        "range.30d": "30 days",
        "range.90d": "90 days",
        "range.all": "All",
        "span.today": "Today",
        "span.days": "Last {n} days",
        "span.all": "Since {date}",
        "kpi.tokens": "Total tokens",
        "kpi.up": "↑ {pct} vs previous {n} days",
        "kpi.down": "↓ {pct} vs previous {n} days",
        "kpi.upToday": "↑ {pct} vs yesterday",
        "kpi.downToday": "↓ {pct} vs yesterday",
        "kpi.noPrevious": "No usage in the previous period",
        "kpi.since": "Since {date}",
        "kpi.tokensTip": "Uncached input + cache read + cache write + output\nReasoning is part of output",
        "kpi.previousTip": "Previous period: {from} – {to}\n{tokens} tokens",
        "kpi.requests": "Requests",
        "kpi.perRequest": "{value} per request",
        "kpi.requestsTip": "Model calls that reported token usage",
        "kpi.cache": "Cache hit rate",
        "kpi.cacheNote": "Cache reads in all input",
        "kpi.cacheTip": "Cache read ÷ all input\nAll input = uncached input + cache read + cache write",
        "kpi.daily": "Daily average",
        "kpi.activeDays": "{n} active days",
        "kpi.activeDay": "{n} active day",
        "kpi.dailyTip": "Averaged over the days with usage",
        "comp.title": "Token composition",
        "comp.cacheRead": "Cache read",
        "comp.input": "Uncached input",
        "comp.cacheWrite": "Cache write",
        "comp.output": "Output (incl. reasoning)",
        "comp.outputShort": "Output",
        "comp.reasoning": "Reasoning {value}",
        "comp.tip": "{label}\n{value} tokens\n{pct} of the total",
        "heat.title": "Daily usage",
        "heat.weeks": "Last {n} weeks",
        "heat.prev": "Earlier",
        "heat.next": "Later",
        "heat.cell": "{date}\n{tokens} tokens\n{requests} requests",
        "heat.none": "{date}\nNo usage",
        "heat.less": "Less",
        "heat.more": "More",
        "heat.label": "Daily token usage calendar",
        "day.mon": "Mon",
        "day.wed": "Wed",
        "day.fri": "Fri",
        "day.sun": "Sun",
        "stat.active": "Active days",
        "stat.current": "Current streak",
        "stat.longest": "Longest streak",
        "stat.peak": "Peak day",
        "stat.days": "{n} days",
        "stat.day": "{n} day",
        "stat.peakValue": "{value} ({date})",
        "stat.none": "—",
        "trend.title": "Trend",
        "trend.byType": "By type",
        "trend.byProvider": "By provider",
        "trend.mode": "Trend breakdown",
        "trend.weekly": "weekly",
        "trend.hourly": "by hour",
        "trend.other": "Other",
        "trend.total": "Total {value}",
        "trend.week": "Week of {date}",
        "trend.label": "Token usage over time",
        "prov.title": "By provider",
        "prov.name": "Provider / model",
        "prov.share": "Share",
        "prov.tokens": "Tokens",
        "prov.requests": "Requests",
        "prov.removed": "Removed providers: {value}, included in the totals",
        "prov.removedTip": "{count} providers no longer registered\n{tokens} tokens · {requests} requests",
        "prov.empty": "No usage in this range",
        "prov.expand": "Show models",
        "prov.collapse": "Hide models",
        "prov.rowTip": "{tokens} tokens\n{requests} requests",
        "hours.title": "Active hours",
        "hours.sub": "Average tokens per hour",
        "hours.tip": "{from}–{to}\n{value} tokens per active day",
        "hours.peak": "Busiest",
        "hours.split": "Weekdays / weekends",
        "hours.label": "Average tokens by hour of day",
        "empty.title": "No usage recorded yet",
        "empty.body": "Token usage appears here once models are called in a conversation. Existing conversations are imported once, automatically.",
        "empty.importing": "Importing the usage of existing conversations; the figures appear as sessions are read.",
        "loading": "Reading usage…",
        "error.load": "Could not read the usage records: {message}",
        "error.newer": "The usage records were written by a newer version of this plugin. Update the plugin to read them.",
        "error.unavailable": "The plugin's host half is not running. Reload the DeepSeek Harness window.",
        "retry": "Retry",
      },
      zh: {
        "lang": "zh-CN",
        "tab.label": "用量",
        "title": "Token 用量",
        "live": "实时更新",
        "liveTip": "每次模型调用完成后，按 DeepSeek Harness 的对话记录计入\n包括子智能体对话、上下文压缩与已计费的失败调用",
        "importing": "正在导入历史记录 {done} / {total}",
        "importTip": "首次读取已有对话；之后启动时只读取有变化的对话",
        "writeFailed": "用量记录暂时无法保存，将自动重试",
        "range.label": "统计区间",
        "range.today": "今日",
        "range.7d": "7 天",
        "range.30d": "30 天",
        "range.90d": "90 天",
        "range.all": "全部",
        "span.today": "今日",
        "span.days": "近 {n} 天",
        "span.all": "自 {date} 起",
        "kpi.tokens": "Token 总量",
        "kpi.up": "较前 {n} 天 ↑ {pct}",
        "kpi.down": "较前 {n} 天 ↓ {pct}",
        "kpi.upToday": "较昨日 ↑ {pct}",
        "kpi.downToday": "较昨日 ↓ {pct}",
        "kpi.noPrevious": "上一周期无用量",
        "kpi.since": "自 {date} 起",
        "kpi.tokensTip": "未缓存输入 + 缓存读取 + 缓存写入 + 输出\n推理 Token 已含在输出中",
        "kpi.previousTip": "上一周期：{from} 至 {to}\n{tokens} tokens",
        "kpi.requests": "请求次数",
        "kpi.perRequest": "平均每次 {value}",
        "kpi.requestsTip": "报告了 Token 用量的模型调用次数",
        "kpi.cache": "缓存命中率",
        "kpi.cacheNote": "缓存读取占全部输入",
        "kpi.cacheTip": "缓存读取 ÷ 全部输入\n全部输入 = 未缓存输入 + 缓存读取 + 缓存写入",
        "kpi.daily": "日均 Token",
        "kpi.activeDays": "活跃 {n} 天",
        "kpi.activeDay": "活跃 {n} 天",
        "kpi.dailyTip": "按有用量的天数平均",
        "comp.title": "Token 构成",
        "comp.cacheRead": "缓存读取",
        "comp.input": "未缓存输入",
        "comp.cacheWrite": "缓存写入",
        "comp.output": "输出（含推理）",
        "comp.outputShort": "输出",
        "comp.reasoning": "其中推理 {value}",
        "comp.tip": "{label}\n{value} tokens\n占总量 {pct}",
        "heat.title": "每日用量",
        "heat.weeks": "近 {n} 周",
        "heat.prev": "更早",
        "heat.next": "更晚",
        "heat.cell": "{date}\n{tokens} tokens\n{requests} 次请求",
        "heat.none": "{date}\n无用量",
        "heat.less": "少",
        "heat.more": "多",
        "heat.label": "每日 Token 用量日历",
        "day.mon": "一",
        "day.wed": "三",
        "day.fri": "五",
        "day.sun": "日",
        "stat.active": "活跃天数",
        "stat.current": "当前连续",
        "stat.longest": "最长连续",
        "stat.peak": "单日最高",
        "stat.days": "{n} 天",
        "stat.day": "{n} 天",
        "stat.peakValue": "{value}（{date}）",
        "stat.none": "—",
        "trend.title": "趋势",
        "trend.byType": "按类型",
        "trend.byProvider": "按服务商",
        "trend.mode": "趋势分类方式",
        "trend.weekly": "按周汇总",
        "trend.hourly": "按小时",
        "trend.other": "其他",
        "trend.total": "合计 {value}",
        "trend.week": "{date} 起一周",
        "trend.label": "Token 用量趋势",
        "prov.title": "按服务商",
        "prov.name": "服务商 / 模型",
        "prov.share": "占比",
        "prov.tokens": "Token",
        "prov.requests": "请求",
        "prov.removed": "另有已移除服务商 {value}，已计入总量",
        "prov.removedTip": "{count} 个服务商已不在 DeepSeek Harness 中\n{tokens} tokens · {requests} 次请求",
        "prov.empty": "本区间无用量",
        "prov.expand": "展开模型",
        "prov.collapse": "收起模型",
        "prov.rowTip": "{tokens} tokens\n{requests} 次请求",
        "hours.title": "活跃时段",
        "hours.sub": "每小时平均 Token",
        "hours.tip": "{from}–{to}\n每个活跃日平均 {value} tokens",
        "hours.peak": "最活跃",
        "hours.split": "工作日 / 周末",
        "hours.label": "按小时的平均 Token 用量",
        "empty.title": "还没有用量记录",
        "empty.body": "在对话中调用模型后，这里会显示 Token 用量。已有对话的历史用量会自动导入一次。",
        "empty.importing": "正在导入已有对话的用量，读取过程中会陆续显示。",
        "loading": "正在读取用量…",
        "error.load": "无法读取用量记录：{message}",
        "error.newer": "用量记录由更新版本的本插件写入，请更新插件后查看。",
        "error.unavailable": "插件的宿主部分未运行，请重新加载 DeepSeek Harness 窗口。",
        "retry": "重试",
      },
    };

    // ---------------------------------------------------------------- CSS

    const CSS = `
.ti-view { box-sizing: border-box; width: 100%; max-width: var(--dsh-chat-content-width, 1320px); margin: 0 auto;
  padding: 20px 0 calc(var(--dsh-composer-height, 152px) + 24px); display: flex; flex-direction: column; gap: 14px;
  container: ti / inline-size; color: var(--dsw-alias-label-primary); font-size: 13px;
  --b1: var(--dsw-static-deepseek-100, #e4edfd); --b2: var(--dsw-static-deepseek-200, #d3e2ff); --b3: var(--dsw-static-deepseek-300, #b7c8fe);
  --b4: var(--dsw-static-deepseek-450, #5686fe); --b5: var(--dsw-static-deepseek-600, #4868b2);
  --empty: color-mix(in srgb, var(--dsw-alias-label-primary, #000) 6%, transparent);
  --card: var(--dsw-alias-bg-layer-1, transparent); --line: var(--dsw-alias-border-l1, rgba(0, 0, 0, .08));
  --dim: var(--dsw-alias-label-secondary); --faint: var(--dsw-alias-label-tertiary); }
/* Dark: the same hue, every level visible on a dark card; the accent (b4) is DeepSeek Harness's dark link blue (400). */
body[data-ds-dark-theme] .ti-view { --b1: var(--dsw-static-deepseek-800, #34415b); --b2: var(--dsw-static-deepseek-600, #4868b2);
  --b3: var(--dsw-static-deepseek-450, #5686fe); --b4: var(--dsw-static-deepseek-400, #7aaaff); --b5: var(--dsw-static-deepseek-300, #b7c8fe); }
.ti-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 28px; }
.ti-title { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
.ti-live { display: inline-flex; align-items: center; gap: 6px; color: var(--faint); font-size: 12px; }
.ti-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary, #22a55a); flex: none; }
.ti-warn { color: var(--dsw-alias-state-warn-label, var(--dim)); font-size: 12px; }
.ti-spacer { flex: 1; }
.ti-seg { display: inline-flex; padding: 2px; border-radius: 8px; background: var(--empty); }
.ti-seg button { border: 0; background: transparent; color: var(--dim); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; cursor: pointer; }
.ti-seg button[aria-pressed="true"] { background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0, 0, 0, .08); font-weight: 500; }
.ti-card { box-sizing: border-box; min-width: 0; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.ti-card-h { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; min-height: 24px; flex-wrap: wrap; }
.ti-card-t { margin: 0; font-size: 13px; font-weight: 600; }
.ti-card-s { color: var(--faint); font-size: 12px; }
.ti-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.ti-kpi { position: relative; overflow: hidden; min-height: 92px; }
.ti-kpi-l { color: var(--dim); font-size: 12px; }
.ti-kpi-m { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; margin-top: 6px; }
.ti-kpi-v { font-size: 24px; font-weight: 600; letter-spacing: -.02em; line-height: 32px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ti-kpi-d { margin-top: 4px; color: var(--faint); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ti-kpi-ring .ti-kpi-d { padding-right: 52px; }
.ti-spark { flex: none; width: 84px; height: 28px; margin-bottom: 3px; overflow: visible; }
.ti-spark polyline { fill: none; stroke: var(--b4); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.ti-ring { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; }
.ti-bar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; gap: 2px; background: var(--empty); }
.ti-bar span { display: block; height: 100%; min-width: 2px; }
.ti-legend { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.ti-lg { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ti-lg-l { display: flex; align-items: center; gap: 6px; color: var(--dim); font-size: 12px; white-space: nowrap; }
.ti-sw { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.ti-lg-v { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ti-lg-p { color: var(--faint); font-size: 12px; font-weight: 400; margin-left: 4px; }
.ti-lg-x { color: var(--faint); font-size: 11px; }
.ti-keys { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 10px; }
.ti-heat-wrap { display: flex; gap: 6px; }
.ti-days { display: grid; grid-template-rows: repeat(7, 11px); gap: 3px; color: var(--faint); font-size: 10px; padding-top: 16px; flex: none; }
.ti-days span { line-height: 11px; }
.ti-heat { flex: 1; min-width: 0; }
.ti-months { position: relative; height: 14px; color: var(--faint); font-size: 10px; margin-bottom: 2px; }
.ti-months span { position: absolute; top: 0; white-space: nowrap; }
.ti-grid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 11px); gap: 3px; }
.ti-grid i { display: block; height: 11px; border-radius: 3px; background: var(--empty); }
.ti-grid i[data-future] { background: transparent; }
.ti-l1 { background: var(--b1) !important; } .ti-l2 { background: var(--b2) !important; } .ti-l3 { background: var(--b3) !important; }
.ti-l4 { background: var(--b4) !important; } .ti-l5 { background: var(--b5) !important; }
.ti-heat-f { display: flex; align-items: flex-end; gap: 16px; margin-top: 12px; flex-wrap: wrap; }
.ti-stat { display: flex; flex-direction: column; gap: 2px; }
.ti-stat-l { color: var(--faint); font-size: 11px; }
.ti-stat-v { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ti-scale { display: inline-flex; align-items: center; gap: 3px; color: var(--faint); font-size: 11px; margin-left: auto; }
.ti-scale i { width: 11px; height: 11px; border-radius: 3px; background: var(--empty); }
.ti-nav { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; }
.ti-icon-btn { display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line); background: transparent; color: var(--dim);
  width: 22px; height: 22px; padding: 0; border-radius: 6px; cursor: pointer; }
.ti-icon-btn:disabled { opacity: .4; cursor: default; }
.ti-icon-btn svg, .ti-caret svg { width: 12px; height: 12px; }
.ti-chart { display: block; width: 100%; overflow: visible; }
.ti-axis { fill: var(--faint); font-size: 10px; font-family: inherit; }
.ti-gridline { stroke: var(--line); shape-rendering: crispEdges; }
.ti-hit { fill: transparent; }
.ti-hit:hover { fill: var(--empty); }
.ti-two { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 10px; align-items: start; }
.ti-rows { display: flex; flex-direction: column; }
.ti-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 64px 56px; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
.ti-row-h { color: var(--faint); font-size: 11px; padding: 0 0 6px; border-top: 0; }
.ti-row-p { cursor: pointer; }
.ti-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ti-name b { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ti-name small { color: var(--faint); font-size: 11px; white-space: nowrap; }
.ti-caret { display: inline-flex; align-items: center; justify-content: center; color: var(--faint); width: 14px; height: 14px; flex: none; padding: 0; border: 0; background: transparent; cursor: pointer; transition: transform 150ms ease; }
.ti-caret[aria-expanded="true"] { transform: rotate(90deg); }
.ti-share { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ti-share span { height: 6px; border-radius: 3px; background: var(--b4); flex: none; }
.ti-share em { color: var(--faint); font-style: normal; font-size: 11px; font-variant-numeric: tabular-nums; }
.ti-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ti-sub .ti-name { padding-left: 22px; }
.ti-sub .ti-name b { font-weight: 400; color: var(--dim); }
.ti-sub .ti-share span { background: var(--b3); }
.ti-note { margin-top: 8px; color: var(--faint); font-size: 11px; }
.ti-hours-f { display: flex; gap: 24px; margin-top: 12px; flex-wrap: wrap; }
.ti-empty { padding: 28px 16px; text-align: center; color: var(--dim); }
.ti-empty h3 { margin: 0 0 6px; font-size: 14px; color: var(--dsw-alias-label-primary); }
.ti-empty p { margin: 0 auto; max-width: 420px; line-height: 1.6; }
.ti-error { display: flex; align-items: center; gap: 10px; color: var(--dsw-alias-state-error-primary, var(--dim)); }
.ti-btn { border: 1px solid var(--line); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 6px; cursor: pointer; }
.ti-muted { color: var(--faint); }
@container ti (max-width: 720px) {
  .ti-kpis, .ti-legend { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ti-two { grid-template-columns: minmax(0, 1fr); }
  .ti-row { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 64px; }
  .ti-row > :nth-child(4) { display: none; }
}
@container ti (max-width: 420px) {
  .ti-kpis, .ti-legend { grid-template-columns: minmax(0, 1fr); }
  .ti-row { grid-template-columns: minmax(0, 1fr) 64px; }
  .ti-row > :nth-child(2) { display: none; }
}
`;

    const styleId = "dsh-token-insights/client.css";
    if (typeof document !== "undefined") {
      // A replaced module re-runs this factory; the newest stylesheet wins.
      document.querySelector(`style[data-plugin-css=${JSON.stringify(styleId)}]`)?.remove();
      const style = document.createElement("style");
      style.dataset.pluginCss = styleId;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /** Register the dictionaries once per live mount (a duplicate registration throws). */
    function installLocale(ctx) {
      const locale = ctx.locale;
      if (locale === undefined || typeof locale.register !== "function") return;
      try {
        if (typeof locale.bind === "function" && locale.bind(NS)("tab.label") !== "tab.label") return;
      } catch {
        /* an unreadable locale face is not a reason to skip the registration */
      }
      try {
        ctx.effect(() => locale.register(NS, DICTS), "dsh-token-insights: locale namespace");
      } catch (error) {
        console.warn("dsh-token-insights: locale namespace already registered; reusing it", error);
      }
    }

    // ------------------------------------------------------------- numbers & dates

    /** A count in short form: 950, 12.3K, 4.56M, 1.23B. */
    function compact(value) {
      const n = Number.isFinite(value) ? value : 0;
      const abs = Math.abs(n);
      const unit = (size, suffix) => {
        const scaled = n / size;
        const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
        return `${scaled.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, "$1")}${suffix}`;
      };
      if (abs >= 1e12) return unit(1e12, "T");
      if (abs >= 1e9) return unit(1e9, "B");
      if (abs >= 1e6) return unit(1e6, "M");
      if (abs >= 1e4) return unit(1e3, "K");
      return Math.round(n).toLocaleString("en-US");
    }
    /** A whole count with group separators. */
    const whole = (value) => Math.round(Number.isFinite(value) ? value : 0).toLocaleString("en-US");
    /** A share as a percentage (one decimal; "<0.1%" for a sliver). */
    function percent(part, total) {
      if (!(total > 0) || !(part > 0)) return "0%";
      const value = (part / total) * 100;
      if (value < 0.1) return "<0.1%";
      return `${value >= 99.95 && part < total ? "99.9" : value.toFixed(1)}%`;
    }
    const pad2 = (n) => String(n).padStart(2, "0");
    /** A local day key (`YYYY-MM-DD`) and back. */
    const dayKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    function dateOf(day) {
      const [year, month, date] = String(day).split("-").map(Number);
      return new Date(year, month - 1, date);
    }
    function shiftDay(day, offset) {
      const date = dateOf(day);
      return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset));
    }
    /** Monday-based weekday (0 = Monday … 6 = Sunday). */
    const weekdayOf = (day) => (dateOf(day).getDay() + 6) % 7;
    function formatter(lang, options) {
      try {
        return new Intl.DateTimeFormat(lang, options);
      } catch {
        return new Intl.DateTimeFormat("en-US", options);
      }
    }
    const fullDay = (lang, day) => formatter(lang, { month: "short", day: "numeric", weekday: "short" }).format(dateOf(day));
    const datedDay = (lang, day) => formatter(lang, { year: "numeric", month: "short", day: "numeric" }).format(dateOf(day));
    const shortDay = (day) => `${dateOf(day).getMonth() + 1}/${dateOf(day).getDate()}`;
    const monthName = (lang, day) => formatter(lang, { month: "short" }).format(dateOf(day));
    const hourLabel = (hour) => `${hour}:00`;

    /** A round step for about `count` gridlines up to `max`. */
    function niceStep(max, count = 3) {
      if (!(max > 0)) return 1;
      const raw = max / count;
      const magnitude = 10 ** Math.floor(Math.log10(raw));
      for (const factor of [1, 2, 2.5, 5, 10]) if (factor * magnitude >= raw) return factor * magnitude;
      return 10 * magnitude;
    }

    // -------------------------------------------------------------- calendar maths

    /**
     * The calendar's span: `weeks` Monday-first columns ending with the week of `end`, every cell's day and figures,
     * the month labels, and the span's statistics.
     * @param {[string, number, number][]} calendar - every recorded day: `[day, tokens, requests]`.
     * @param {object} options - `end` (day key), `today` (day key), `weeks`, `lang`.
     */
    function heatSpan(calendar, { end, today, weeks, lang = "en-US" }) {
      const byDay = new Map(calendar.map(([day, tokens, requests]) => [day, { tokens, requests }]));
      const start = shiftDay(end, -(weekdayOf(end) + (weeks - 1) * 7));
      const cells = [];
      const months = [];
      let max = 0;
      let lastLabelColumn = -10;
      for (let column = 0; column < weeks; column += 1) {
        for (let row = 0; row < 7; row += 1) {
          const day = shiftDay(start, column * 7 + row);
          const figures = byDay.get(day);
          const cell = { day, tokens: figures?.tokens ?? 0, requests: figures?.requests ?? 0, future: day > today };
          if (cell.tokens > max && !cell.future) max = cell.tokens;
          cells.push(cell);
          if (dateOf(day).getDate() === 1 && column - lastLabelColumn >= 3) {
            months.push({ column, label: monthName(lang, day) });
            lastLabelColumn = column;
          }
        }
      }
      const visible = cells.filter((cell) => !cell.future);
      const active = visible.filter((cell) => cell.tokens > 0).length;
      let longest = 0;
      let run = 0;
      let peak = null;
      for (const cell of visible) {
        run = cell.tokens > 0 ? run + 1 : 0;
        if (run > longest) longest = run;
        if (cell.tokens > 0 && (peak === null || cell.tokens > peak.tokens)) peak = cell;
      }
      return { start, end: shiftDay(start, weeks * 7 - 1), cells, months, max, active, longest, peak };
    }

    /** Consecutive days with usage ending today (or yesterday, while today has none yet). */
    function currentStreak(calendar, today) {
      const active = new Set(calendar.filter(([, tokens]) => tokens > 0).map(([day]) => day));
      let day = active.has(today) ? today : shiftDay(today, -1);
      let streak = 0;
      while (active.has(day)) {
        streak += 1;
        day = shiftDay(day, -1);
      }
      return streak;
    }

    /** A cell's shade (0 none … 5 deepest), by the square root of its share of the span's largest day. */
    const levelOf = (tokens, max) => (tokens > 0 && max > 0 ? Math.min(5, 1 + Math.floor(Math.sqrt(tokens / max) * 5)) : 0);

    /** The daily series bucketed by Monday-first week (the week's first day as its date). */
    function byWeek(daily, width) {
      const weeks = [];
      for (const row of daily) {
        const monday = shiftDay(row.date, -weekdayOf(row.date));
        let week = weeks[weeks.length - 1];
        if (week === undefined || week.date !== monday) {
          week = { date: monday, tokens: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, byProvider: new Array(width).fill(0) };
          weeks.push(week);
        }
        for (const field of ["tokens", "requests", "input", "output", "cacheRead", "cacheWrite"]) week[field] += row[field];
        row.byProvider.forEach((value, index) => {
          week.byProvider[index] += value;
        });
      }
      return weeks;
    }

    // ------------------------------------------------------------------ store

    let call = async () => {
      throw new Error("remote.tokenInsights is not mounted");
    };

    function readPrefs() {
      try {
        const value = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}");
        return value !== null && typeof value === "object" ? value : {};
      } catch {
        return {};
      }
    }
    function writePrefs(patch) {
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
      } catch {
        /* a convenience only */
      }
    }

    /** The figures of a range, re-read while the tab is open and the window visible. */
    function useStats(range) {
      const [state, setState] = useState({ data: null, error: null, range: null });
      const [nonce, setNonce] = useState(0);
      useEffect(() => {
        let alive = true;
        let timer = null;
        const schedule = (ms) => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") schedule(ms);
            else void load();
          }, ms);
        };
        const load = async () => {
          clearTimeout(timer);
          try {
            const data = await call("stats", { range });
            if (!alive) return;
            setState({ data, error: null, range });
            schedule(data?.status?.importing ? IMPORT_POLL_MS : POLL_MS);
          } catch (error) {
            if (!alive) return;
            setState((previous) => ({ ...previous, error }));
            schedule(POLL_MS);
          }
        };
        const onVisible = () => {
          if (document.visibilityState === "visible") void load();
        };
        document.addEventListener("visibilitychange", onVisible);
        void load();
        return () => {
          alive = false;
          clearTimeout(timer);
          document.removeEventListener("visibilitychange", onVisible);
        };
      }, [range, nonce]);
      return { ...state, retry: () => setNonce((n) => n + 1) };
    }

    /** An element's content width, kept current. */
    function useWidth() {
      const ref = useRef(null);
      const [width, setWidth] = useState(0);
      useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return undefined;
        const measure = () => setWidth(Math.floor(node.clientWidth));
        measure();
        if (typeof ResizeObserver !== "function") return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
      }, []);
      return [ref, width];
    }

    // ------------------------------------------------------------------ pieces

    const icon = (d) => h("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, h("path", { d }));
    const CHEVRON_RIGHT = "M6 3.5 10.5 8 6 12.5";
    const CHEVRON_LEFT = "M10 3.5 5.5 8 10 12.5";

    /** The DSH segmented control (its own look and keys); a plain button row where the host has none. */
    function Segments({ id, value, options, onChange, label }) {
      if (typeof P.SegmentedControl === "function") return h(P.SegmentedControl, { id, value, options, onChange, label, className: "ti-segmented" });
      return h("div", { className: "ti-seg", role: "group", "aria-label": label },
        options.map((option) => h("button", {
          key: option.value,
          type: "button",
          "aria-pressed": option.value === value ? "true" : "false",
          onClick: () => option.value !== value && onChange(option.value),
        }, option.label)));
    }

    function Sparkline({ values }) {
      const points = values.length;
      if (points < 2) return null;
      const max = Math.max(...values);
      if (!(max > 0)) return null;
      const line = values.map((value, index) => `${((index / (points - 1)) * 84).toFixed(1)},${(26 - (value / max) * 24).toFixed(1)}`).join(" ");
      return h("svg", { className: "ti-spark", viewBox: "0 0 84 28", "aria-hidden": "true" }, h("polyline", { points: line }));
    }

    function Ring({ share }) {
      const radius = 18;
      const circumference = 2 * Math.PI * radius;
      const filled = Math.max(0, Math.min(1, share)) * circumference;
      return h("svg", { className: "ti-ring", viewBox: "0 0 44 44", "aria-hidden": "true" },
        h("circle", { cx: 22, cy: 22, r: radius, fill: "none", stroke: "var(--empty)", strokeWidth: 5 }),
        filled > 0 ? h("circle", { cx: 22, cy: 22, r: radius, fill: "none", stroke: "var(--b4)", strokeWidth: 5, strokeLinecap: "round", strokeDasharray: `${filled.toFixed(1)} ${circumference.toFixed(1)}`, transform: "rotate(-90 22 22)" }) : null);
    }

    function Kpi({ label, value, note, tip, noteTip, art, ring }) {
      return h("div", { className: `ti-card ti-kpi${ring ? " ti-kpi-ring" : ""}` },
        h("div", { className: "ti-kpi-l", "data-tip": tip }, label),
        h("div", { className: "ti-kpi-m" }, h("div", { className: "ti-kpi-v" }, value), ring ? null : art),
        h("div", { className: "ti-kpi-d", "data-tip": noteTip }, note),
        ring ? art : null);
    }

    function spanText(t, data, lang) {
      if (data.range.key === "today") return t("span.today");
      if (data.range.key === "all") return t("span.all", { date: datedDay(lang, data.firstDay ?? data.today) });
      return t("span.days", { n: data.range.days });
    }

    function Kpis({ t, data, lang }) {
      const { totals, previous, range } = data;
      let delta;
      let deltaTip;
      if (previous === null) {
        delta = t("kpi.since", { date: datedDay(lang, data.firstDay ?? data.today) });
      } else if (!(previous.tokens > 0)) {
        delta = t("kpi.noPrevious");
      } else {
        const change = (totals.tokens - previous.tokens) / previous.tokens;
        const pct = `${Math.abs(change * 100).toFixed(1)}%`;
        const today = range.key === "today";
        delta = change >= 0 ? t(today ? "kpi.upToday" : "kpi.up", { pct, n: range.days }) : t(today ? "kpi.downToday" : "kpi.down", { pct, n: range.days });
        deltaTip = t("kpi.previousTip", { from: fullDay(lang, previous.from), to: fullDay(lang, previous.to), tokens: whole(previous.tokens) });
      }
      const allInput = totals.input + totals.cacheRead + totals.cacheWrite;
      const hitRate = allInput > 0 ? totals.cacheRead / allInput : 0;
      const daily = data.activeDays > 0 ? totals.tokens / data.activeDays : 0;
      const today = range.key === "today";
      const tokenSeries = today ? data.hours : data.daily.map((row) => row.tokens);
      const requestSeries = today ? [] : data.daily.map((row) => row.requests);
      const weekly = data.daily.length > 14 ? byWeek(data.daily, 0).map((week) => week.tokens) : [];
      return h("div", { className: "ti-kpis" },
        h(Kpi, { label: t("kpi.tokens"), value: compact(totals.tokens), note: delta, tip: `${whole(totals.tokens)} tokens\n${t("kpi.tokensTip")}`, noteTip: deltaTip, art: h(Sparkline, { values: tokenSeries }) }),
        h(Kpi, { label: t("kpi.requests"), value: whole(totals.requests), note: t("kpi.perRequest", { value: compact(totals.requests > 0 ? totals.tokens / totals.requests : 0) }), tip: t("kpi.requestsTip"), art: h(Sparkline, { values: requestSeries }) }),
        h(Kpi, { label: t("kpi.cache"), value: `${(hitRate * 100).toFixed(1)}%`, note: t("kpi.cacheNote"), tip: t("kpi.cacheTip"), art: h(Ring, { share: hitRate }), ring: true }),
        h(Kpi, { label: t("kpi.daily"), value: compact(daily), note: t(data.activeDays === 1 ? "kpi.activeDay" : "kpi.activeDays", { n: data.activeDays }), tip: t("kpi.dailyTip"), art: h(Sparkline, { values: weekly }) }));
    }

    /** The four parts of the total, deepest last (output). */
    const PARTS = [["cacheRead", "comp.cacheRead", "var(--b4)"], ["input", "comp.input", "var(--b1)"], ["cacheWrite", "comp.cacheWrite", "var(--b2)"], ["output", "comp.output", "var(--b5)"]];

    function Composition({ t, data, lang }) {
      const { totals } = data;
      return h("section", { className: "ti-card" },
        h("div", { className: "ti-card-h" }, h("h3", { className: "ti-card-t" }, t("comp.title")), h("span", { className: "ti-card-s" }, spanText(t, data, lang))),
        h("div", { className: "ti-bar", role: "img", "aria-label": PARTS.map(([field, key]) => `${t(key)} ${percent(totals[field], totals.tokens)}`).join(", ") },
          PARTS.filter(([field]) => totals[field] > 0).map(([field, key, colour]) => h("span", {
            key: field,
            style: { width: `${(totals[field] / totals.tokens) * 100}%`, background: colour },
            "data-tip": t("comp.tip", { label: t(key), value: whole(totals[field]), pct: percent(totals[field], totals.tokens) }),
          }))),
        h("div", { className: "ti-legend" }, PARTS.map(([field, key, colour]) => h("div", { className: "ti-lg", key: field },
          h("span", { className: "ti-lg-l" }, h("i", { className: "ti-sw", style: { background: colour } }), t(key)),
          h("span", { className: "ti-lg-v", "data-tip": `${whole(totals[field])} tokens` }, compact(totals[field]), h("span", { className: "ti-lg-p" }, percent(totals[field], totals.tokens))),
          field === "output" && totals.reasoning > 0 ? h("span", { className: "ti-lg-x", "data-tip": `${whole(totals.reasoning)} tokens` }, t("comp.reasoning", { value: compact(totals.reasoning) })) : null))));
    }

    function Calendar({ t, data, lang }) {
      const [ref, width] = useWidth();
      const [end, setEnd] = useState(null);
      // Columns at least 9px wide (plus the 3px gap); before the first measurement, the full span.
      const weeks = width > 0 ? Math.max(13, Math.min(HEAT_WEEKS, Math.floor((width - 30) / 12))) : HEAT_WEEKS;
      const today = data.today;
      const shownEnd = end ?? today;
      const span = useMemo(() => heatSpan(data.calendar, { end: shownEnd, today, weeks, lang }), [data.calendar, shownEnd, today, weeks, lang]);
      const streak = useMemo(() => currentStreak(data.calendar, today), [data.calendar, today]);
      const step = (direction) => {
        const next = shiftDay(shownEnd, direction * weeks * 7);
        setEnd(next >= today ? null : next);
      };
      const canEarlier = data.firstDay !== null && data.firstDay < span.start;
      const canLater = shownEnd < today;
      const columnWidth = 100 / weeks;
      const days = (n) => t(n === 1 ? "stat.day" : "stat.days", { n });
      return h("section", { className: "ti-card" },
        h("div", { className: "ti-card-h" },
          h("h3", { className: "ti-card-t" }, t("heat.title")),
          h("span", { className: "ti-card-s" }, t("heat.weeks", { n: weeks })),
          h("span", { className: "ti-nav" },
            h("button", { type: "button", className: "ti-icon-btn", disabled: !canEarlier, onClick: () => step(-1), "aria-label": t("heat.prev"), "data-tip": t("heat.prev") }, icon(CHEVRON_LEFT)),
            h("span", null, `${span.start} — ${span.end > today ? today : span.end}`),
            h("button", { type: "button", className: "ti-icon-btn", disabled: !canLater, onClick: () => step(1), "aria-label": t("heat.next"), "data-tip": t("heat.next") }, icon(CHEVRON_RIGHT)))),
        h("div", { className: "ti-heat-wrap", ref },
          h("div", { className: "ti-days", "aria-hidden": "true" }, ["day.mon", null, "day.wed", null, "day.fri", null, "day.sun"].map((key, index) => h("span", { key: index }, key ? t(key) : ""))),
          h("div", { className: "ti-heat" },
            h("div", { className: "ti-months", "aria-hidden": "true" }, span.months.map((month) => h("span", { key: month.column, style: { left: `${month.column * columnWidth}%` } }, month.label))),
            h("div", { className: "ti-grid", role: "img", "aria-label": t("heat.label"), style: { gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` } },
              span.cells.map((cell) => {
                if (cell.future) return h("i", { key: cell.day, "data-future": "" });
                const level = levelOf(cell.tokens, span.max);
                return h("i", {
                  key: cell.day,
                  className: level > 0 ? `ti-l${level}` : undefined,
                  "data-tip": cell.tokens > 0
                    ? t("heat.cell", { date: fullDay(lang, cell.day), tokens: compact(cell.tokens), requests: whole(cell.requests) })
                    : t("heat.none", { date: fullDay(lang, cell.day) }),
                });
              })))),
        h("div", { className: "ti-heat-f" },
          h(Stat, { label: t("stat.active"), value: days(span.active) }),
          h(Stat, { label: t("stat.current"), value: days(streak) }),
          h(Stat, { label: t("stat.longest"), value: days(span.longest) }),
          h(Stat, { label: t("stat.peak"), value: span.peak ? t("stat.peakValue", { value: compact(span.peak.tokens), date: shortDay(span.peak.day) }) : t("stat.none"), tip: span.peak ? `${fullDay(lang, span.peak.day)}\n${whole(span.peak.tokens)} tokens` : undefined }),
          h("span", { className: "ti-scale", "aria-hidden": "true" }, t("heat.less"), h("i"), [1, 2, 3, 4, 5].map((level) => h("i", { key: level, className: `ti-l${level}` })), t("heat.more"))));
    }

    function Stat({ label, value, tip }) {
      return h("div", { className: "ti-stat" }, h("span", { className: "ti-stat-l" }, label), h("span", { className: "ti-stat-v", "data-tip": tip }, value));
    }

    /** Stacked bars at the measured width (never stretched): one column per day, week or hour. */
    function Bars({ columns, colours, height, label, xLabels }) {
      const [ref, width] = useWidth();
      const left = 40;
      const bottom = 18;
      const plotWidth = Math.max(0, width - left - 4);
      const plotHeight = height - bottom - 6;
      const max = Math.max(0, ...columns.map((column) => column.parts.reduce((sum, value) => sum + value, 0)));
      const step = niceStep(max);
      const top = max > 0 ? Math.ceil(max / step) * step : step * 3;
      const ticks = [];
      for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);
      const slot = columns.length > 0 ? plotWidth / columns.length : 0;
      const barWidth = Math.max(1, Math.min(28, slot * 0.64));
      const y = (value) => 6 + plotHeight - (value / top) * plotHeight;
      const labelEvery = Math.max(1, Math.ceil(columns.length / Math.max(1, Math.floor(plotWidth / 64))));
      return h("div", { ref },
        width > 0 ? h("svg", { className: "ti-chart", width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": label },
          ticks.map((value) => h("g", { key: value },
            h("line", { className: "ti-gridline", x1: left, x2: width - 4, y1: Math.round(y(value)) + 0.5, y2: Math.round(y(value)) + 0.5 }),
            h("text", { className: "ti-axis", x: left - 6, y: y(value) + 3, textAnchor: "end" }, compact(value)))),
          columns.map((column, index) => {
            const x = left + slot * index + (slot - barWidth) / 2;
            let base = 0;
            const segments = column.parts.map((value, part) => {
              if (!(value > 0)) return null;
              const from = y(base);
              base += value;
              const to = y(base);
              return h("rect", { key: part, x, y: to, width: barWidth, height: Math.max(0.5, from - to), fill: colours[part], rx: barWidth >= 6 ? 1.5 : 0 });
            });
            return h("g", { key: column.key },
              h("rect", { className: "ti-hit", x: left + slot * index, y: 6, width: slot, height: plotHeight, "data-tip": column.tip }),
              h("g", { pointerEvents: "none" }, segments),
              index % labelEvery === 0 ? h("text", { className: "ti-axis", x: left + slot * index + slot / 2, y: height - 4, textAnchor: "middle" }, xLabels(column, index)) : null);
          })) : null);
    }

    const PROVIDER_COLOURS = ["var(--b5)", "var(--b4)", "var(--b3)", "var(--b2)", "var(--b1)"];

    function Trend({ t, data, lang, mode, setMode }) {
      const today = data.range.key === "today";
      const weekly = data.daily.length > DAILY_BARS_MAX;
      const seriesNames = [...data.series.map((entry) => entry.name || entry.id), t("trend.other")];
      const rows = weekly ? byWeek(data.daily, data.series.length + 1) : data.daily;
      let columns;
      let colours;
      let xLabels;
      if (today) {
        colours = ["var(--b4)"];
        columns = data.hours.map((tokens, hour) => ({ key: hour, parts: [tokens], tip: `${hourLabel(hour)}–${hourLabel(hour + 1)}\n${whole(tokens)} tokens` }));
        xLabels = (column) => hourLabel(column.key);
      } else if (mode === "provider") {
        colours = PROVIDER_COLOURS.slice(0, data.series.length).concat("var(--b1)");
        columns = rows.map((row) => ({
          key: row.date,
          parts: row.byProvider,
          tip: [weekly ? t("trend.week", { date: fullDay(lang, row.date) }) : fullDay(lang, row.date), t("trend.total", { value: whole(row.tokens) }),
            ...row.byProvider.map((value, index) => (value > 0 ? `${seriesNames[index]} ${compact(value)}` : null)).filter(Boolean)].join("\n"),
        }));
        xLabels = (column) => shortDay(column.key);
      } else {
        colours = PARTS.map(([, , colour]) => colour);
        columns = rows.map((row) => ({
          key: row.date,
          parts: PARTS.map(([field]) => row[field]),
          tip: [weekly ? t("trend.week", { date: fullDay(lang, row.date) }) : fullDay(lang, row.date), t("trend.total", { value: whole(row.tokens) }),
            ...PARTS.map(([field, key]) => (row[field] > 0 ? `${t(key)} ${compact(row[field])}` : null)).filter(Boolean)].join("\n"),
        }));
        xLabels = (column) => shortDay(column.key);
      }
      const subtitle = [spanText(t, data, lang), today ? t("trend.hourly") : weekly ? t("trend.weekly") : null].filter(Boolean).join(" · ");
      return h("section", { className: "ti-card" },
        h("div", { className: "ti-card-h" },
          h("h3", { className: "ti-card-t" }, t("trend.title")),
          h("span", { className: "ti-card-s" }, subtitle),
          h("span", { className: "ti-spacer" }),
          today ? null : h(Segments, {
            id: "ti-trend-mode",
            value: mode,
            label: t("trend.mode"),
            onChange: setMode,
            options: [{ value: "type", label: t("trend.byType") }, { value: "provider", label: t("trend.byProvider") }],
          })),
        h(Bars, { columns, colours, height: 160, label: t("trend.label"), xLabels }),
        !today && mode === "provider" && data.series.length > 0 ? h("div", { className: "ti-keys" },
          seriesNames.slice(0, data.series.length + (rows.some((row) => row.byProvider[data.series.length] > 0) ? 1 : 0)).map((name, index) => h("span", { className: "ti-lg-l", key: index },
            h("i", { className: "ti-sw", style: { background: colours[index] } }), name))) : null);
    }

    function Providers({ t, data, lang }) {
      const [open, setOpen] = useState(null);
      const expanded = open ?? new Set(data.providers.length > 0 ? [data.providers[0].id] : []);
      const toggle = (id) => {
        const next = new Set(expanded);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setOpen(next);
      };
      const total = data.totals.tokens;
      const top = data.providers[0]?.tokens ?? 0;
      const share = (tokens) => h("div", { className: "ti-share" },
        h("span", { style: { width: `${top > 0 ? Math.max(2, (tokens / top) * 70) : 0}%` } }),
        h("em", null, percent(tokens, total)));
      const rows = [];
      for (const provider of data.providers) {
        const isOpen = expanded.has(provider.id);
        rows.push(h("div", { className: "ti-row ti-row-p", key: provider.id, onClick: () => toggle(provider.id) },
          h("div", { className: "ti-name" },
            h("button", { type: "button", className: "ti-caret", "aria-expanded": isOpen ? "true" : "false", "aria-label": isOpen ? t("prov.collapse") : t("prov.expand"), onClick: (event) => {
              event.stopPropagation();
              toggle(provider.id);
            } }, icon(CHEVRON_RIGHT)),
            h("b", { "data-tip": provider.id !== provider.name ? `${provider.name}${provider.tag ? ` · ${provider.tag}` : ""}\n${provider.id}` : undefined }, provider.name || provider.id),
            provider.tag ? h("small", null, provider.tag) : null),
          share(provider.tokens),
          h("span", { className: "ti-num", "data-tip": `${whole(provider.tokens)} tokens` }, compact(provider.tokens)),
          h("span", { className: "ti-num" }, whole(provider.requests))));
        if (!isOpen) continue;
        for (const model of provider.models) {
          rows.push(h("div", { className: "ti-row ti-sub", key: `${provider.id}\u0000${model.model}` },
            h("div", { className: "ti-name" }, h("b", { "data-tip": model.model }, model.model)),
            share(model.tokens),
            h("span", { className: "ti-num", "data-tip": `${whole(model.tokens)} tokens` }, compact(model.tokens)),
            h("span", { className: "ti-num" }, whole(model.requests))));
        }
      }
      return h("section", { className: "ti-card" },
        h("div", { className: "ti-card-h" }, h("h3", { className: "ti-card-t" }, t("prov.title")), h("span", { className: "ti-card-s" }, spanText(t, data, lang))),
        data.providers.length === 0
          ? h("div", { className: "ti-muted" }, t("prov.empty"))
          : h("div", { className: "ti-rows" },
            h("div", { className: "ti-row ti-row-h" }, h("span", null, t("prov.name")), h("span", null, t("prov.share")), h("span", { className: "ti-num" }, t("prov.tokens")), h("span", { className: "ti-num" }, t("prov.requests"))),
            rows),
        data.removed.tokens > 0 ? h("div", { className: "ti-note", "data-tip": t("prov.removedTip", { count: data.removed.providers, tokens: whole(data.removed.tokens), requests: whole(data.removed.requests) }) },
          t("prov.removed", { value: compact(data.removed.tokens) })) : null);
    }

    function Hours({ t, data }) {
      const days = Math.max(1, data.activeDays);
      const averages = data.hours.map((tokens) => tokens / days);
      const max = Math.max(0, ...averages);
      let peak = -1;
      averages.forEach((value, hour) => {
        if (value > 0 && (peak < 0 || value > averages[peak])) peak = hour;
      });
      const split = data.weekday + data.weekend;
      const columns = averages.map((value, hour) => ({ key: hour, parts: [value], tip: t("hours.tip", { from: hourLabel(hour), to: hourLabel(hour + 1), value: compact(value) }) }));
      return h("section", { className: "ti-card" },
        h("div", { className: "ti-card-h" }, h("h3", { className: "ti-card-t" }, t("hours.title")), h("span", { className: "ti-card-s" }, t("hours.sub"))),
        h(HourBars, { columns, max }),
        h("div", { className: "ti-hours-f" },
          h(Stat, { label: t("hours.peak"), value: peak >= 0 ? `${hourLabel(peak)}–${hourLabel(peak + 1)}` : t("stat.none") }),
          h(Stat, { label: t("hours.split"), value: split > 0 ? `${Math.round((data.weekday / split) * 100)}% / ${100 - Math.round((data.weekday / split) * 100)}%` : t("stat.none") })));
    }

    /** 24 hour columns, each shaded by its height (one hue). */
    function HourBars({ columns, max }) {
      const [ref, width] = useWidth();
      const height = 120;
      const bottom = 18;
      const plot = height - bottom - 4;
      const slot = width / 24;
      const bar = Math.max(2, slot * 0.68);
      return h("div", { ref },
        width > 0 ? h("svg", { className: "ti-chart", width, height, viewBox: `0 0 ${width} ${height}`, role: "img" },
          columns.map((column, hour) => {
            const value = column.parts[0];
            const barHeight = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * plot) : 0;
            const level = levelOf(value, max);
            return h("g", { key: hour },
              h("rect", { className: "ti-hit", x: slot * hour, y: 4, width: slot, height: plot, "data-tip": column.tip }),
              h("rect", { x: slot * hour + (slot - bar) / 2, y: 4 + plot - Math.max(2, barHeight), width: bar, height: Math.max(2, barHeight), rx: Math.min(2, bar / 3), fill: level > 0 ? `var(--b${level})` : "var(--empty)", pointerEvents: "none" }),
              hour % 6 === 0 ? h("text", { className: "ti-axis", x: slot * hour + slot / 2, y: height - 4, textAnchor: "middle" }, hourLabel(hour)) : null);
          })) : null);
    }

    function errorText(t, error) {
      const message = String(error?.message ?? error ?? "");
      if (/newer version|LEDGER_NEWER/i.test(message)) return t("error.newer");
      if (/not mounted|remote\.tokenInsights|unknown namespace|no such method/i.test(message)) return t("error.unavailable");
      return t("error.load", { message });
    }

    function Header({ t, data, range, setRange }) {
      const status = data?.status;
      return h("div", { className: "ti-head" },
        h("h2", { className: "ti-title" }, t("title")),
        status?.importing
          ? h("span", { className: "ti-live", "data-tip": t("importTip") },
            typeof P.StateDot === "function" ? h(P.StateDot, { state: "ongoing", size: 12 }) : h("i", { className: "ti-dot" }),
            t("importing", { done: whole(status.imported), total: whole(status.toImport) }))
          : data ? h("span", { className: "ti-live", "data-tip": t("liveTip") }, h("i", { className: "ti-dot" }), t("live")) : null,
        status?.writeFailed ? h("span", { className: "ti-warn" }, t("writeFailed")) : null,
        h("span", { className: "ti-spacer" }),
        h(Segments, { id: "ti-range", value: range, label: t("range.label"), onChange: setRange, options: RANGES.map((key) => ({ value: key, label: t(`range.${key}`) })) }));
    }

    function TokenInsightsView({ t }) {
      const prefs = useMemo(readPrefs, []);
      const [range, setRangeState] = useState(RANGES.includes(prefs.range) ? prefs.range : "30d");
      const [mode, setModeState] = useState(prefs.trend === "provider" ? "provider" : "type");
      const setRange = (value) => {
        setRangeState(value);
        writePrefs({ range: value });
      };
      const setMode = (value) => {
        setModeState(value);
        writePrefs({ trend: value });
      };
      const { data, error, retry } = useStats(range);
      const lang = t("lang") === "zh-CN" ? "zh-CN" : "en-US";
      let body;
      if (data === null && error !== null) {
        body = h("div", { className: "ti-card ti-error" }, h("span", null, errorText(t, error)), h("button", { type: "button", className: "ti-btn", onClick: retry }, t("retry")));
      } else if (data === null) {
        body = h("div", { className: "ti-card ti-muted" }, t("loading"));
      } else if (data.calendar.length === 0 && data.totals.tokens === 0) {
        body = h("div", { className: "ti-card ti-empty" }, h("h3", null, t("empty.title")), h("p", null, t(data.status?.importing ? "empty.importing" : "empty.body")));
      } else {
        body = [
          error !== null ? h("div", { className: "ti-card ti-error", key: "error" }, h("span", null, errorText(t, error)), h("button", { type: "button", className: "ti-btn", onClick: retry }, t("retry"))) : null,
          h(Kpis, { t, data, lang, key: "kpis" }),
          h(Composition, { t, data, lang, key: "composition" }),
          h(Calendar, { t, data, lang, key: "calendar" }),
          h(Trend, { t, data, lang, mode, setMode, key: "trend" }),
          h("div", { className: "ti-two", key: "two" }, h(Providers, { t, data, lang }), h(Hours, { t, data })),
        ];
      }
      return h("div", { className: "ti-view" }, h(Header, { t, data, range, setRange }), body);
    }
    TokenInsightsView.displayName = "TokenInsights";

    // ------------------------------------------------------------ hover notes

    /**
     * Hover notes drawn as DeepSeek Harness draws its own (ui-primitives Tooltip: the bubble's colour tokens, 13 / 20 px
     * type, line breaks kept), at most TIP_MAX_WIDTH wide, for this page's `data-tip` attributes only (charts move from
     * cell to cell, so a note follows at once once one is showing). A reload of the plugin replaces the previous layer.
     */
    const TIP_MAX_WIDTH = 320;
    const TIP_DELAY_MS = 250;
    const TIP_GAP = 8;
    const TIP_MARGIN = 12;
    function installTips() {
      if (typeof document === "undefined" || typeof window === "undefined" || !document.body) return () => {};
      const slot = "__dshTips:dsh-token-insights";
      if (typeof window[slot] === "function") window[slot]();
      let bubble = null;
      let current = null;
      let timer = null;
      let showing = false;
      const anchorOf = (node) => {
        const el = node && typeof node.closest === "function" ? node.closest("[data-tip]") : null;
        return el && el.closest(".ti-view") && el.getAttribute("data-tip") ? el : null;
      };
      const ensure = () => {
        if (bubble) return bubble;
        bubble = document.createElement("div");
        bubble.setAttribute("role", "tooltip");
        Object.assign(bubble.style, {
          position: "fixed", zIndex: "1100", left: "0px", top: "0px", width: "max-content", boxSizing: "border-box",
          maxWidth: `min(${TIP_MAX_WIDTH}px, calc(100vw - ${TIP_MARGIN * 2}px))`, padding: "3px 7px", borderRadius: "var(--dsw-radius-sm, 6px)",
          background: "var(--dsw-alias-tooltip-bg, rgba(28, 30, 36, 0.94))", color: "var(--dsw-alias-tooltip-label, var(--dsw-static-neutral-bluish-00, #ffffff))",
          fontFamily: "var(--dsw-font-family, inherit)", fontSize: "13px", fontWeight: "400", lineHeight: "20px", letterSpacing: "normal", textAlign: "left",
          whiteSpace: "pre-line", overflowWrap: "break-word", fontVariantNumeric: "tabular-nums", pointerEvents: "none", visibility: "hidden", opacity: "0",
          transition: "opacity 120ms var(--ds-ease-in-out, ease-in-out)",
        });
        document.body.appendChild(bubble);
        return bubble;
      };
      const hide = () => {
        clearTimeout(timer);
        timer = null;
        showing = false;
        current = null;
        if (bubble) {
          bubble.style.visibility = "hidden";
          bubble.style.opacity = "0";
        }
      };
      const show = () => {
        timer = null;
        const el = current;
        if (!el || !el.isConnected) return;
        const text = String(el.getAttribute("data-tip") ?? "").trim();
        if (!text) return;
        const node = ensure();
        node.textContent = text.replace(/(\d)-(?=\d)/g, "$1‑");
        node.style.visibility = "hidden";
        const box = node.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const left = Math.max(TIP_MARGIN, Math.min(rect.left + rect.width / 2 - box.width / 2, window.innerWidth - TIP_MARGIN - box.width));
        const above = rect.top - TIP_GAP - box.height;
        const top = above >= TIP_MARGIN ? above : Math.max(TIP_MARGIN, Math.min(rect.bottom + TIP_GAP, window.innerHeight - TIP_MARGIN - box.height));
        node.style.left = `${Math.round(left)}px`;
        node.style.top = `${Math.round(top)}px`;
        node.style.visibility = "visible";
        node.style.opacity = "1";
        showing = true;
      };
      const hold = (el) => {
        if (el === current) return;
        clearTimeout(timer);
        current = el;
        if (showing) show();
        else timer = setTimeout(show, TIP_DELAY_MS);
      };
      const onOver = (event) => {
        const el = anchorOf(event.target);
        if (el) hold(el);
        else if (current) hide();
      };
      const onFocus = (event) => {
        const el = anchorOf(event.target);
        if (el && el === event.target && typeof el.matches === "function" && el.matches(":focus-visible")) hold(el);
      };
      const onKey = (event) => {
        if (event.key === "Escape") hide();
      };
      const listeners = [[document, "pointerover", onOver], [document, "focusin", onFocus], [document, "pointerdown", hide], [document, "keydown", onKey], [window, "scroll", hide], [window, "blur", hide]];
      for (const [target, type, handler] of listeners) target.addEventListener(type, handler, true);
      const dispose = () => {
        hide();
        for (const [target, type, handler] of listeners) target.removeEventListener(type, handler, true);
        bubble?.remove();
        bubble = null;
        if (window[slot] === dispose) delete window[slot];
      };
      window[slot] = dispose;
      return dispose;
    }

    // ------------------------------------------------------------------ apply

    const METHODS = ["stats"];
    const inert = (typeSymbol) => ({ mode: "strict", typeSymbol, create: () => ({ parse: (value) => value }) });
    const descriptors = METHODS.map((method) => ({
      id: `dsh-token-insights#tokenInsights/${method}`,
      service: "tokenInsights",
      namespace: "tokenInsights",
      method,
      invocation: { kind: "direct" },
      parameters: [{ name: "request", wire: "request", source: "json", codec: inert("dsh-token-insights/types#TokenInsightsStatsRequest") }],
      cancellation: { parameter: "signal" },
      result: inert(`dsh-token-insights#tokenInsights/${method}:result`),
    }));

    async function apply(ctx) {
      installLocale(ctx);
      ctx.effect(() => installTips(), "dsh-token-insights: hover notes");
      const remote = ctx.remote;
      if (remote !== undefined && typeof remote.$mount === "function" && ctx.get("remote.tokenInsights") === undefined) {
        const unmount = await remote.$mount({ package: "dsh-token-insights", descriptors });
        if (unmount !== undefined) ctx.effect(() => unmount, "dsh-token-insights: remote contribution");
      }
      call = async (method, request) => {
        const service = ctx.get("remote.tokenInsights");
        if (service === undefined || typeof service[method] !== "function") throw new Error("remote.tokenInsights is not mounted");
        const result = await service[method](request);
        if (result?.ok === true) return result.value;
        const code = typeof result?.error?.code === "string" ? ` (${result.error.code})` : "";
        throw new Error(`${String(result?.error?.message ?? "request failed")}${code}`);
      };
      const slots = ctx.slots;
      if (slots === undefined) return;
      // DeepSeek Harness calls a tab's label with no arguments (at each tab-list refresh): it translates through the
      // bound namespace, so a language switch relabels the tab.
      let translate = null;
      try {
        translate = typeof ctx.locale?.bind === "function" ? ctx.locale.bind(NS) : null;
      } catch {
        translate = null;
      }
      const tabLabel = () => {
        const text = translate?.("tab.label");
        return typeof text === "string" && text !== "tab.label" ? text : DICTS.en["tab.label"];
      };
      ctx.effect(() => slots.inject("conversation.view", () => slots.register({
        name: "conversation.view",
        id: "token-insights",
        // After Chat / Trajectory, before the plugins' key tabs (Antigravity 30, CN 31+, Intl 41+, Custom 60).
        order: 20,
        locale: NS,
        label: tabLabel,
      }, TokenInsightsView)), "dsh-token-insights: usage tab");
    }

    exports.name = "dsh-token-insights";
    exports.apply = apply;
    exports.inject = ["remote", "slots", "locale"];
    /** Pure helpers and the view, exposed for the self-test only. */
    exports.__internals = Object.freeze({
      installTips, compact, whole, percent, niceStep, heatSpan, currentStreak, levelOf, byWeek, shiftDay, dayKey, DICTS, RANGES, TokenInsightsView,
      /** Replace the host call (render tests). */
      setCall: (fn) => {
        call = fn;
      },
    });
    return module.exports;
  },
});
