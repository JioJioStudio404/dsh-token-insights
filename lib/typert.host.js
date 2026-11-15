/**
 * Typert manifest for the `tokenInsights` host face.
 *
 * Written by hand in the shape `@deepseek-ai/dsh-typert-generator` emits, so `typert-loader` registers it when this
 * package's loader entry mounts: a strict codec describes the wire boundary the Gateway validates, and `model` is the
 * documentation the service catalog reads. The codecs are plain objects exposing `parse()` — a third-party plugin
 * cannot resolve `zod`/`schemastery` from the DeepSeek Harness tree.
 *
 * The loader validates this manifest strictly during its activation pass, and a defect there fails the loader for
 * every contributor — `test/verify.mjs` runs a port of that validation over this file.
 *
 * @module dsh-token-insights/typert
 */

const PACKAGE = "dsh-token-insights";

/** The ranges the page offers (the keys of `RANGES` in `ledger.js`). */
const RANGE_KEYS = ["today", "7d", "30d", "90d", "all"];

/** Strict codec for the `stats` request: an object with an optional `range`. */
const statsRequestCodec = {
  mode: "strict",
  typeSymbol: `${PACKAGE}/types#TokenInsightsStatsRequest`,
  create: () => ({
    parse(value) {
      const subject = "tokenInsights.stats request";
      if (value === undefined || value === null) return {};
      if (typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${subject} must be an object`);
      for (const key of Object.keys(value)) if (key !== "range") throw new TypeError(`${subject} has an unexpected field ${JSON.stringify(key)}`);
      if (value.range === undefined) return {};
      if (!RANGE_KEYS.includes(value.range)) throw new TypeError(`${subject}.range must be one of ${RANGE_KEYS.join(", ")}`);
      return { range: value.range };
    },
  }),
};

/** Result codec that passes the handler's own value through unchanged. */
const passthroughResultCodec = (typeSymbol) => ({ mode: "strict", typeSymbol, create: () => ({ parse: (value) => value }) });

/** One direct invocation with a single JSON `request` parameter and the carrier signal. */
function invocation(method, codec) {
  return {
    id: `${PACKAGE}#tokenInsights/${method}`,
    service: "tokenInsights",
    namespace: "tokenInsights",
    method,
    invocation: { kind: "direct" },
    parameters: [{ name: "request", wire: "request", source: "json", codec }],
    cancellation: { parameter: "signal" },
    result: passthroughResultCodec(`${PACKAGE}#tokenInsights/${method}:result`),
  };
}

export const TYPERT = {
  package: PACKAGE,
  face: "host",
  schemas: [],
  invocations: [invocation("stats", statsRequestCodec)],
  model: {
    services: [{
      key: "tokenInsights",
      exportName: "TokenInsights",
      description: "Host service backing the `ctx.remote.tokenInsights` namespace: token usage of every model call DeepSeek Harness logged (subagent sessions and compaction included), counted from the Session logs into a local ledger of daily buckets.",
      summary: "Host service backing the `ctx.remote.tokenInsights` namespace.",
      jsDoc: "/** Host service backing the `ctx.remote.tokenInsights` namespace. */",
      tags: [],
      members: [{
        kind: "method",
        name: "stats",
        signature: "stats(request: TokenInsightsStatsRequest, signal: AbortSignal): Promise<TokenInsightsStats>",
        summary: "The token figures of one range: totals, composition, daily series, calendar, providers and models, hours.",
        jsDoc: "/**\n * The token figures of one range, from the local ledger (written first when calls are waiting): totals and the\n * previous period's, the composition (cache read, uncached input, cache write, output with reasoning), the daily\n * series (by type and by the four largest providers), every recorded day for the calendar, providers registered now\n * with their models (providers no longer registered are summed separately), and tokens by hour of day.\n * @param request - the range (`today`, `7d`, `30d`, `90d`, `all`; default `30d`).\n * @param signal - caller lifetime.\n * @returns the range's figures and the import status.\n */",
      }],
      types: [
        {
          name: "TokenInsightsStatsRequest",
          declaration: "export interface TokenInsightsStatsRequest {\n    readonly range?: \"today\" | \"7d\" | \"30d\" | \"90d\" | \"all\";\n}",
        },
        {
          name: "TokenInsightsStats",
          declaration: "export interface TokenInsightsStats {\n    readonly range: { readonly key: string; readonly from: string; readonly to: string; readonly days: number };\n    readonly today: string;\n    readonly totals: { readonly requests: number; readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly reasoning: number; readonly tokens: number };\n    readonly previous: { readonly tokens: number; readonly requests: number; readonly from: string; readonly to: string } | null;\n    readonly activeDays: number;\n    readonly daily: readonly { readonly date: string; readonly tokens: number; readonly requests: number; readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly byProvider: readonly number[] }[];\n    readonly series: readonly { readonly id: string; readonly name: string; readonly tag: string | null }[];\n    readonly providers: readonly { readonly id: string; readonly name: string; readonly tag: string | null; readonly tokens: number; readonly requests: number; readonly models: readonly { readonly model: string; readonly tokens: number; readonly requests: number }[] }[];\n    readonly removed: { readonly providers: number; readonly tokens: number; readonly requests: number };\n    readonly hours: readonly number[];\n    readonly weekday: number;\n    readonly weekend: number;\n    readonly calendar: readonly (readonly [string, number, number])[];\n    readonly firstDay: string | null;\n    readonly status: { readonly importing: boolean; readonly imported: number; readonly toImport: number; readonly importFailed: number; readonly importedAt: number | null; readonly writeFailed: boolean; readonly generatedAt: number };\n}",
        },
      ],
    }],
    events: [],
    objects: [],
  },
};

export default TYPERT;
