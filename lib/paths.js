/**
 * Where this plugin keeps its file.
 *
 * DeepSeek Harness's own home resolution is `DSH_HOME`, then `~/.dsh`, on every platform. A third-party plugin cannot
 * import `@deepseek-ai/dsh-home-paths`, so the rule is restated here.
 *
 * @module dsh-token-insights/paths
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** The DeepSeek Harness home directory. */
export function dshHome(env = process.env) {
  const configured = typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  return configured.length > 0 ? configured : join(homedir(), ".dsh");
}

/** The usage ledger: `$DSH_HOME/storages/token-insights.json`. */
export const ledgerPath = (env = process.env) => join(dshHome(env), "storages", "token-insights.json");
