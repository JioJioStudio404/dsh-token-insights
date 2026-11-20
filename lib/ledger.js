/**
 * The usage ledger: what is counted, how it is stored, and the figures the page shows.
 *
 * Pure functions over plain data (no I/O), so every rule here is tested directly.
 *
 * What counts: every model call DeepSeek Harness logged with token usage — an `assistant/message` event that carries
 * `usage` (one per agent step, subagent sessions included), a `compaction/summary` event that carries `usage` (the
 * summarization call), and an `assistant/attempt` (a call that failed, such as a content refusal) whose stream carries
 * usage. A call whose usage is all zero is not counted. A Session's events are counted once each, by
 * their `seq` (the event's index in the Session's log); a forked Session's inherited prefix belongs to its parent and
 * is never counted again.
 *
 * Token figures are DeepSeek Harness's own `TokenUsage`, which is disjoint: `inputTokens` is uncached input only,
 * `cacheReadTokens` / `cacheWriteTokens` are the cached parts, and `reasoningTokens` is already inside `outputTokens`.
 * A call's total is input + cache read + cache write + output (reasoning never added again).
 *
 * The ledger keeps day buckets in the host's local time zone, never per-call rows: per day, per provider route, per
 * model, the six counters below, plus the day's tokens per hour. Nothing is ever removed from it: a deleted Session or
 * a removed provider keeps its counts (a provider no longer registered is counted in the totals and left out of the
 * provider list).
 *
 * @module dsh-token-insights/ledger
 */

/** Ledger format version. */
export const LEDGER_VERSION = 1;

/** The counters of one bucket, by index. */
export const FIELDS = Object.freeze(["requests", "input", "output", "cacheRead", "cacheWrite", "reasoning"]);
const WIDTH = FIELDS.length;

/** Names that, as an object key, reach the prototype or constructor instead of an entry of its own. */
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
/** Whether a name may be an object key. */
export const isSafeKey = (name) => typeof name === "string" && name.length <= 512 && !UNSAFE.has(name);
/** Set an object's own entry (a plain data property, whatever the name). */
function put(target, name, value) {
  Object.defineProperty(target, name, { value, writable: true, enumerable: true, configurable: true });
  return value;
}
/** An object's own entry under a name, made with `make()` first when there is none. */
function slot(target, name, make) {
  return Object.hasOwn(target, name) ? target[name] : put(target, name, make());
}
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** A non-negative whole count, or 0. */
const count = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** The provider key for a call whose route is not recorded. */
export const UNKNOWN = "(unknown)";

/** A day key (`YYYY-MM-DD`). */
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An empty ledger. */
export function emptyLedger(now = Date.now()) {
  return { version: LEDGER_VERSION, createdAt: now, days: {}, sessions: {} };
}

/**
 * A ledger read from disk, checked entry by entry: anything malformed is dropped, the rest kept.
 * @param {unknown} value - the parsed file (or null when there is none).
 * @param {number} [now] - creation time for a new ledger.
 * @returns the ledger.
 * @throws when the file was written by a newer format (it is never overwritten then).
 */
export function normalizeLedger(value, now = Date.now()) {
  if (!isRecord(value)) return emptyLedger(now);
  if (typeof value.version === "number" && value.version > LEDGER_VERSION) {
    const error = new Error(`the usage ledger was written by a newer version (format ${value.version})`);
    error.code = "LEDGER_NEWER";
    throw error;
  }
  const ledger = emptyLedger(typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : now);
  if (isRecord(value.days)) {
    for (const [day, bucket] of Object.entries(value.days)) {
      if (!DAY.test(day) || !isRecord(bucket) || !isRecord(bucket.m)) continue;
      const models = {};
      for (const [provider, byModel] of Object.entries(bucket.m)) {
        if (!isSafeKey(provider) || !isRecord(byModel)) continue;
        for (const [model, vec] of Object.entries(byModel)) {
          if (!isSafeKey(model) || !Array.isArray(vec)) continue;
          const clean = Array.from({ length: WIDTH }, (_, index) => count(vec[index]));
          if (clean[0] === 0 && tokensOf(clean) === 0) continue;
          put(slot(models, provider, () => ({})), model, clean);
        }
      }
      const hours = Array.from({ length: 24 }, (_, index) => count(Array.isArray(bucket.h) ? bucket.h[index] : 0));
      if (Object.keys(models).length > 0) put(ledger.days, day, { m: models, h: hours });
    }
  }
  if (isRecord(value.sessions)) {
    for (const [id, record] of Object.entries(value.sessions)) {
      if (!isSafeKey(id) || !isRecord(record) || !Number.isSafeInteger(record.last) || record.last < -1) continue;
      const entry = { last: record.last };
      if (typeof record.fp === "string" && record.fp.length <= 128) entry.fp = record.fp;
      put(ledger.sessions, id, entry);
    }
  }
  return ledger;
}

/** A call's total tokens: input + cache read + cache write + output (reasoning is inside output). */
export const tokensOf = (vec) => vec[1] + vec[2] + vec[3] + vec[4];

/**
 * The route a `request/context` event sets for the requests after it, or null for any other event. DeepSeek Harness
 * appends one only when the route (or the window) changes, so a Session's current route is the last one in its log.
 * @param {unknown} event - a SessionEvent.
 * @returns `{ provider, model }`, or null.
 */
export function routeOf(event) {
  if (!isRecord(event) || event.type !== "request/context" || !isRecord(event.data)) return null;
  return { provider: event.data.provider, model: event.data.model };
}

/** The last usage chunk a failed attempt's recorded stream carries, or undefined. */
function attemptUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const entry = stream[index];
    if (isRecord(entry) && entry.type === "chunk" && isRecord(entry.chunk) && entry.chunk.type === "usage") return entry.chunk.usage;
  }
  return undefined;
}

/**
 * The model call one Session event records, or null when it records none.
 * - `assistant/message`: a step's answer (its route is in the message's source).
 * - `compaction/summary`: the summarization call.
 * - `assistant/attempt`: a call that failed or was stopped before any answer — DeepSeek Harness logs one only then,
 *   never beside the step's `assistant/message`. It counts when its stream carries usage: the provider billed it (a
 *   content refusal reports its usage before failing, DeepSeek Harness 0.2.2-rc.4 on). Its route is the Session's
 *   current one (`route`, from the last {@link routeOf} before it).
 * @param {unknown} event - a SessionEvent (`{ type, seq, time, data }`).
 * @param {{ provider?: unknown, model?: unknown } | null} [route] - the Session's route at this event.
 * @returns `{ provider, model, vec }` (`vec` in {@link FIELDS} order, requests = 1), or null.
 */
export function usageOf(event, route = null) {
  if (!isRecord(event) || !isRecord(event.data)) return null;
  const data = event.data;
  let provider;
  let model;
  let usage = data.usage;
  if (event.type === "assistant/message") {
    const source = isRecord(data.message) && isRecord(data.message.source) ? data.message.source : {};
    provider = source.provider;
    model = source.model;
  } else if (event.type === "compaction/summary") {
    provider = data.provider;
    model = data.model;
  } else if (event.type === "assistant/attempt") {
    usage = attemptUsage(data.stream);
    provider = route?.provider;
    model = route?.model;
  } else {
    return null;
  }
  if (!isRecord(usage)) return null;
  const vec = [1, count(usage.inputTokens), count(usage.outputTokens), count(usage.cacheReadTokens), count(usage.cacheWriteTokens), count(usage.reasoningTokens)];
  if (tokensOf(vec) === 0) return null;
  // Reasoning is part of output; a provider that reports more reasoning than output is held to the output.
  vec[5] = Math.min(vec[5], vec[2]);
  const name = (value) => (typeof value === "string" && value.length > 0 && isSafeKey(value) ? value : UNKNOWN);
  return { provider: name(provider), model: name(model), vec };
}

/** The local calendar day and hour of a time. */
export function localSlot(time) {
  const date = new Date(typeof time === "number" && Number.isFinite(time) ? time : Date.now());
  return { day: dayKey(date), hour: date.getHours() };
}

/** A local Date's day key. */
export function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The local Date (midnight) of a day key. */
export function dateOf(day) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

/** The day key `offset` days after a day key (negative: before). */
export function shiftDay(day, offset) {
  const date = dateOf(day);
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset));
}

/** Add one counted call to the ledger. */
export function addCall(ledger, { time, provider, model, vec }) {
  const { day, hour } = localSlot(time);
  const bucket = slot(ledger.days, day, () => ({ m: {}, h: new Array(24).fill(0) }));
  const target = slot(slot(bucket.m, provider, () => ({})), model, () => new Array(WIDTH).fill(0));
  for (let index = 0; index < WIDTH; index += 1) target[index] += vec[index];
  bucket.h[hour] += tokensOf(vec);
}

/**
 * Apply what one process observed to a ledger (the copy just read from disk, under the lock): per Session, the calls
 * whose `seq` lies past what the ledger already counted, in order, then the Session's new high-water mark. A call
 * another process counted first is skipped, so two processes never count one call twice.
 * @param {object} ledger - the ledger to change.
 * @param {Map<string, {base?: number, upTo: number, items: object[], fp?: string}>} batch - per Session: `base` (the
 *   last inherited seq, for a Session the ledger has not seen), `upTo` (the highest seq observed, counted or not),
 *   the counted calls (`{ seq, time, provider, model, vec }`, ascending seq) and the persistence fingerprint.
 * @returns the number of calls added.
 */
export function mergeBatch(ledger, batch) {
  let added = 0;
  for (const [id, observed] of batch) {
    if (!isSafeKey(id)) continue;
    const known = Object.hasOwn(ledger.sessions, id) ? ledger.sessions[id] : undefined;
    let last = known !== undefined ? known.last : Number.isSafeInteger(observed.base) ? observed.base : -1;
    for (const item of observed.items) {
      if (item.seq <= last) continue;
      addCall(ledger, item);
      last = item.seq;
      added += 1;
    }
    if (Number.isSafeInteger(observed.upTo) && observed.upTo > last) last = observed.upTo;
    const entry = { last };
    if (typeof observed.fp === "string") entry.fp = observed.fp;
    else if (known?.fp !== undefined) entry.fp = known.fp;
    put(ledger.sessions, id, entry);
  }
  return added;
}

/** The ranges the page offers, in days (null: everything recorded). */
export const RANGES = Object.freeze({ today: 1, "7d": 7, "30d": 30, "90d": 90, all: null });

/** A provider route name split into its name and the plugin's mark (`Kimi · CN_Ex` → `Kimi`, `CN_Ex`). */
export function splitRouteName(raw) {
  const text = typeof raw === "string" ? raw : "";
  const at = text.lastIndexOf(" · ");
  return at > 0 ? { name: text.slice(0, at), tag: text.slice(at + 3) } : { name: text, tag: null };
}

/** How many providers the trend chart shows by name (the rest are summed as one). */
export const TREND_SERIES = 4;

/**
 * The figures of one range.
 * @param {object} ledger - the ledger.
 * @param {object} options
 * @param {string} options.range - a key of {@link RANGES}.
 * @param {number} [options.now] - the current time.
 * @param {Map<string, string> | null} [options.names] - the providers registered now (id → route name); null when
 *   unknown, then every provider is listed under its id.
 * @returns the range's figures (see the `stats` result in `typert.host.js`).
 */
export function aggregate(ledger, { range = "30d", now = Date.now(), names = null } = {}) {
  const key = Object.hasOwn(RANGES, range) ? range : "30d";
  const today = dayKey(new Date(now));
  const recorded = Object.keys(ledger.days).sort();
  const first = recorded.find((day) => day <= today) ?? null;
  const length = RANGES[key] ?? (first === null ? 1 : daysBetween(first, today) + 1);
  const from = shiftDay(today, -(length - 1));
  const listed = (provider) => names === null || names.has(provider);

  const totals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, tokens: 0 };
  const providers = new Map();
  const removed = { providers: new Set(), tokens: 0, requests: 0 };
  const hours = new Array(24).fill(0);
  let weekday = 0;
  let weekend = 0;
  let activeDays = 0;
  const days = [];
  for (let offset = 0; offset < length; offset += 1) {
    const day = shiftDay(from, offset);
    const bucket = Object.hasOwn(ledger.days, day) ? ledger.days[day] : null;
    const row = { date: day, tokens: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, byProvider: new Map() };
    if (bucket !== null) {
      for (const [provider, byModel] of Object.entries(bucket.m)) {
        for (const [model, vec] of Object.entries(byModel)) {
          const tokens = tokensOf(vec);
          row.tokens += tokens;
          row.requests += vec[0];
          row.input += vec[1];
          row.output += vec[2];
          row.cacheRead += vec[3];
          row.cacheWrite += vec[4];
          totals.reasoning += vec[5];
          row.byProvider.set(provider, (row.byProvider.get(provider) ?? 0) + tokens);
          if (!listed(provider)) {
            removed.providers.add(provider);
            removed.tokens += tokens;
            removed.requests += vec[0];
            continue;
          }
          const entry = providers.get(provider) ?? { id: provider, tokens: 0, requests: 0, models: new Map() };
          entry.tokens += tokens;
          entry.requests += vec[0];
          const modelEntry = entry.models.get(model) ?? { model, tokens: 0, requests: 0 };
          modelEntry.tokens += tokens;
          modelEntry.requests += vec[0];
          entry.models.set(model, modelEntry);
          providers.set(provider, entry);
        }
      }
      for (let hour = 0; hour < 24; hour += 1) hours[hour] += bucket.h[hour];
    }
    if (row.tokens > 0) {
      activeDays += 1;
      const weekdayIndex = dateOf(day).getDay();
      if (weekdayIndex === 0 || weekdayIndex === 6) weekend += row.tokens;
      else weekday += row.tokens;
    }
    for (const field of ["tokens", "requests", "input", "output", "cacheRead", "cacheWrite"]) totals[field] += row[field];
    days.push(row);
  }

  // Previous period of the same length, for the change in the total (none for "everything").
  let previous = null;
  if (RANGES[key] !== null) {
    previous = { tokens: 0, requests: 0, from: shiftDay(from, -length), to: shiftDay(from, -1) };
    for (let offset = 0; offset < length; offset += 1) {
      const day = shiftDay(previous.from, offset);
      if (!Object.hasOwn(ledger.days, day)) continue;
      for (const byModel of Object.values(ledger.days[day].m)) {
        for (const vec of Object.values(byModel)) {
          previous.tokens += tokensOf(vec);
          previous.requests += vec[0];
        }
      }
    }
  }

  const ranked = [...providers.values()].sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));
  const label = (id) => splitRouteName(names?.get(id) ?? id);
  const series = ranked.slice(0, TREND_SERIES).map((entry) => ({ id: entry.id, ...label(entry.id) }));
  const seriesIndex = new Map(series.map((entry, index) => [entry.id, index]));
  const daily = days.map((row) => {
    const byProvider = new Array(series.length + 1).fill(0);
    for (const [provider, tokens] of row.byProvider) byProvider[seriesIndex.get(provider) ?? series.length] += tokens;
    return { date: row.date, tokens: row.tokens, requests: row.requests, input: row.input, output: row.output, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, byProvider };
  });

  // Every recorded day (any range), for the calendar.
  const calendar = [];
  for (const day of recorded) {
    if (day > today) continue;
    let tokens = 0;
    let requests = 0;
    for (const byModel of Object.values(ledger.days[day].m)) {
      for (const vec of Object.values(byModel)) {
        tokens += tokensOf(vec);
        requests += vec[0];
      }
    }
    if (tokens > 0) calendar.push([day, tokens, requests]);
  }

  return {
    range: { key, from, to: today, days: length },
    today,
    totals,
    previous,
    activeDays,
    daily,
    series,
    providers: ranked.map((entry) => ({
      id: entry.id,
      ...label(entry.id),
      tokens: entry.tokens,
      requests: entry.requests,
      models: [...entry.models.values()].sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model)),
    })),
    removed: { providers: removed.providers.size, tokens: removed.tokens, requests: removed.requests },
    hours,
    weekday,
    weekend,
    calendar,
    firstDay: first,
  };
}

/** Whole days from one day key to another (local calendar days). */
export function daysBetween(from, to) {
  return Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 86_400_000);
}
