/**
 * dsh-token-insights — host half.
 *
 * Counts the tokens of every model call DeepSeek Harness logs — the agent's steps, subagent sessions and compaction
 * summaries — into a local ledger (`$DSH_HOME/storages/token-insights.json`, daily buckets per provider and model),
 * and serves the figures to the 「用量」 tab through the `tokenInsights` Remote namespace. Display only: it changes
 * nothing in DeepSeek Harness, sends nothing anywhere, and reads the Session logs only.
 *
 * - Live: `session/event` (every Session, subagents included).
 * - History: at launch (a few seconds after the Session services are up), every stored Session whose log changed
 *   since it was last read; the first launch reads them all once.
 *
 * @module dsh-token-insights
 */
import * as fsPromises from "node:fs/promises";
import { ledgerPath } from "./paths.js";
import { createRecorder } from "./recorder.js";

/** Cordis plugin name. */
export const name = "token-insights";

/** The history import starts this long after the Session services are up (launch work first). */
export const BACKFILL_DELAY_MS = 5_000;

/**
 * The property `remoteMethods()` reads for its Remote method markers. It is a plain string on
 * `dsh-typert-protocol`'s side (not a Symbol), so replicating it here costs no import.
 */
const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";

/** The Remote methods of the `tokenInsights` namespace, in manifest order. */
const REMOTE_METHODS = ["stats"];

/**
 * One service whose Remote shape works under both Gateway discovery modes: the Typert manifest in `./typert`, and the
 * Gateway's fallback that reads the methods from the service's prototype (handlers take the request, then `signal`).
 * @param {{ stats: (request: object) => Promise<object> }} handlers
 * @returns the service value to `ctx.provide`.
 */
export function createTokenInsightsService({ stats }) {
  const prototype = {};
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(REMOTE_METHODS.map((method) => Object.freeze({ method, invocation: Object.freeze({ kind: "direct" }) }))),
    }),
  });
  prototype.stats = async function statsRemote(request, signal) {
    return await stats(request ?? {}, signal);
  };
  const service = Object.create(prototype);
  Object.defineProperty(service, "typertRemote", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: "tokenInsights", namespace: "tokenInsights" },
  });
  return service;
}

/**
 * @param {object} ctx - host plugin context.
 * @param {object} [config] - loader configuration (`file`: another ledger path).
 */
export function apply(ctx, config) {
  if (ctx.get("tokenInsights") !== undefined) {
    // A second mount of this package (two rows, or a hot-installed copy beside an installed one): the first counts.
    ctx.logger?.warn?.("token-insights: tokenInsights is already provided; keeping the mounted service");
    return;
  }
  const file = typeof config?.file === "string" && config.file.length > 0 ? config.file : ledgerPath();
  const recorder = createRecorder({
    fs: fsPromises,
    file,
    query: () => ctx.get("sessionQuery"),
    persistence: () => ctx.get("sessionPersistence"),
    llm: () => ctx.get("llm"),
    logger: ctx.logger,
  });
  ctx.provide("tokenInsights", createTokenInsightsService({ stats: (request) => recorder.stats(request) }));

  // Every Session's events (`global`: subagent and other scoped Sessions too). Observe only; never throws.
  ctx.on("session/event", (session, event) => {
    try {
      recorder.onEvent(session?.id, event);
    } catch (error) {
      ctx.logger?.warn?.(`token-insights: ${String(error?.message ?? error)}`);
    }
  }, { global: true });

  ctx.inject(["sessionQuery", "sessionPersistence"], (sub) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      recorder.backfill(controller.signal).catch((error) => {
        if (!controller.signal.aborted) ctx.logger?.warn?.(`token-insights: history import failed: ${String(error?.message ?? error)}`);
      });
    }, BACKFILL_DELAY_MS);
    timer.unref?.();
    // The sub-plugin's own lifetime: the import stops when either Session service goes away.
    (typeof sub?.effect === "function" ? sub : ctx).effect(() => () => {
      clearTimeout(timer);
      controller.abort();
    }, "token-insights: history import");
  });

  ctx.effect(() => () => {
    void recorder.close();
  }, "token-insights: ledger");
}
