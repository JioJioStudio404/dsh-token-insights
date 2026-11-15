/**
 * The recorder: keeps the usage ledger current from DeepSeek Harness's own Session logs.
 *
 * - Live: every Session event (`session/event`) whose `seq` follows the last one counted for its Session is taken at
 *   once; a Session not seen before, or a gap in its `seq`, is read whole instead ({@link Recorder.onEvent}).
 * - History: at launch, every stored Session whose log changed since it was last read (its persistence fingerprint:
 *   the backend's revision of the log file) is read through `sessionQuery.readSession` — the full log, a fork's inherited prefix left out
 *   ({@link Recorder.backfill}). Sessions that did not change are not read again.
 * - Writes: what was observed is merged into the ledger file under its lock every couple of seconds — read, merged by
 *   `seq`, written atomically — so two processes on one home, or a reload that overlaps the previous mount, never
 *   count one call twice ({@link mergeBatch}).
 *
 * The Session logs stay DeepSeek Harness's: this module only reads them.
 *
 * @module dsh-token-insights/recorder
 */
import { createHash } from "node:crypto";
import { aggregate, mergeBatch, normalizeLedger, usageOf } from "./ledger.js";
import { readJsonFile, withFileLock, writeJsonFile } from "./files.js";

/** Observations are written this long after the first one. */
export const FLUSH_MS = 3_000;
/** A Session to read whole waits this long first (events that arrive meanwhile are read with it). */
export const SYNC_DELAY_MS = 400;
/** A Session whose log could not be read is not tried again for this long. */
export const RETRY_MS = 60_000;

/**
 * A stored Session's persistence fingerprint, or undefined when the backend gives nothing to tell a change by (the
 * Session is then read at every launch; counting stays exact, by seq). DeepSeek Harness's JSONL backend reports a
 * revision built from the log file's identity (device, inode, size, modification and change times) and its size, no
 * event count: the revision changes with every write and stays the same across launches while the file is untouched.
 * Hashed, so the ledger keeps a short value.
 */
export function fingerprint(snapshot) {
  const revision = typeof snapshot?.revision === "string" && snapshot.revision.length > 0 ? snapshot.revision : "";
  const events = Number.isSafeInteger(snapshot?.eventCount) ? snapshot.eventCount : "";
  const bytes = Number.isSafeInteger(snapshot?.sizeBytes) ? snapshot.sizeBytes : "";
  if (revision === "" && (events === "" || bytes === "")) return undefined;
  return createHash("sha256").update(`${revision}\u0000${events}\u0000${bytes}`).digest("base64url").slice(0, 22);
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const yieldTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Join a batch that failed to write with the observations made since (the batch's calls come first). */
function combine(older, newer) {
  const joined = new Map(older);
  for (const [id, observed] of newer) {
    const before = joined.get(id);
    if (before === undefined) {
      joined.set(id, observed);
      continue;
    }
    joined.set(id, {
      base: before.base ?? observed.base,
      upTo: Math.max(before.upTo ?? -1, observed.upTo ?? -1),
      items: [...before.items, ...observed.items],
      fp: observed.fp ?? before.fp,
    });
  }
  return joined;
}

/**
 * @typedef {object} Recorder
 * @property {(sessionId: string, event: object) => void} onEvent - a live Session event.
 * @property {(signal?: AbortSignal) => Promise<void>} backfill - read every stored Session that changed.
 * @property {(request?: { range?: string }) => Promise<object>} stats - the figures of one range.
 * @property {() => Promise<void>} flush - write what was observed.
 * @property {() => Promise<void>} whenIdle - settle the reads and writes in progress (tests).
 * @property {() => Promise<void>} close - write what is left and stop.
 */

/**
 * @param {object} options
 * @param {object} options.fs - `node:fs/promises` (or a test double).
 * @param {string} options.file - the ledger file.
 * @param {() => object | undefined} options.query - DeepSeek Harness's `sessionQuery` service.
 * @param {() => object | undefined} options.persistence - DeepSeek Harness's `sessionPersistence` service.
 * @param {() => object | undefined} options.llm - DeepSeek Harness's `llm` service (provider names).
 * @param {object} [options.logger] - host logger.
 * @param {() => number} [options.now] - clock.
 * @param {number} [options.flushMs] - see {@link FLUSH_MS}.
 * @param {number} [options.syncDelayMs] - see {@link SYNC_DELAY_MS}.
 * @returns {Recorder}
 */
export function createRecorder({ fs, file, query, persistence, llm, logger, now = Date.now, flushMs = FLUSH_MS, syncDelayMs = SYNC_DELAY_MS }) {
  /** The ledger as last read or written (null until loaded). */
  let ledger = null;
  let loading = null;
  /** A ledger that cannot be written (a newer format): its error. */
  let frozen = null;
  /** Observed, not yet written: Session id → `{ base, upTo, items, fp }`. */
  let pending = new Map();
  /** Being written now. */
  let inflight = null;
  let flushTimer = null;
  let chain = Promise.resolve();
  let lastWriteError = null;
  /** Sessions waiting to be read whole, and when a read last failed. */
  const queue = new Set();
  const failedAt = new Map();
  let syncTimer = null;
  let working = null;
  let closing = false;
  const progress = { running: false, total: 0, done: 0, failed: 0, finishedAt: null };

  const warn = (message) => logger?.warn?.(`token-insights: ${message}`);

  /** Load the ledger once (a failed read is tried again on the next call). */
  function ready() {
    if (ledger !== null) return Promise.resolve(ledger);
    if (frozen !== null) return Promise.reject(frozen);
    loading ??= (async () => {
      try {
        ledger = normalizeLedger(await readJsonFile(fs, file), now());
        return ledger;
      } catch (error) {
        if (error?.code === "LEDGER_NEWER") frozen = error;
        throw error;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  /** The highest seq this process knows to be accounted for in a Session (written, being written, or observed). */
  function lastSeq(id) {
    let best;
    const consider = (value) => {
      if (Number.isSafeInteger(value) && (best === undefined || value > best)) best = value;
    };
    if (ledger !== null && Object.hasOwn(ledger.sessions, id)) consider(ledger.sessions[id].last);
    for (const map of [inflight, pending]) {
      const observed = map?.get(id);
      if (observed === undefined) continue;
      consider(observed.base);
      consider(observed.upTo);
    }
    return best;
  }

  function observation(id) {
    let observed = pending.get(id);
    if (observed === undefined) {
      observed = { base: undefined, upTo: undefined, items: [], fp: undefined };
      pending.set(id, observed);
    }
    return observed;
  }

  function scheduleFlush() {
    // After close() nothing is scheduled: what is observed later is read again at the next launch.
    if (flushTimer !== null || frozen !== null || closing) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, flushMs);
    flushTimer.unref?.();
  }

  async function writeBatch() {
    if (pending.size === 0 || ledger === null || frozen !== null) return;
    const batch = pending;
    pending = new Map();
    inflight = batch;
    try {
      await withFileLock(fs, file, async () => {
        const disk = normalizeLedger(await readJsonFile(fs, file), now());
        mergeBatch(disk, batch);
        await writeJsonFile(fs, file, disk);
        ledger = disk;
      });
      lastWriteError = null;
    } catch (error) {
      pending = combine(batch, pending);
      if (error?.code === "LEDGER_NEWER") frozen = error;
      if (lastWriteError?.message !== error?.message) warn(`could not write the usage ledger: ${String(error?.message ?? error)}`);
      lastWriteError = error;
      if (!closing) scheduleFlush();
    } finally {
      inflight = null;
    }
  }

  /** Write what was observed (one write at a time). */
  function flush() {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    chain = chain.then(writeBatch, writeBatch);
    return chain;
  }

  /**
   * Read one Session's whole log and observe the calls past what is accounted for.
   * @param {string} id - the Session.
   * @param {string} [fp] - its persistence fingerprint, recorded with it.
   */
  async function syncSession(id, fp) {
    const service = query();
    if (typeof service?.readSession !== "function") throw new Error("sessionQuery.readSession is not available");
    const snapshot = await service.readSession(id);
    if (ledger === null || closing) return;
    // From here to the end nothing awaits: the observation lands whole, after any live event already taken.
    const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
    const inherited = Number.isSafeInteger(snapshot?.inheritedEventCount) && snapshot.inheritedEventCount > 0 ? snapshot.inheritedEventCount : 0;
    const observed = observation(id);
    let last = lastSeq(id);
    if (last === undefined) {
      last = inherited - 1;
      observed.base = last;
    }
    for (let index = inherited; index < events.length; index += 1) {
      const event = events[index];
      if (!isRecord(event) || !Number.isSafeInteger(event.seq) || event.seq <= last) continue;
      const call = usageOf(event);
      if (call !== null) observed.items.push({ seq: event.seq, time: typeof event.time === "number" ? event.time : now(), ...call });
      last = event.seq;
    }
    if (observed.upTo === undefined || last > observed.upTo) observed.upTo = last;
    if (fp !== undefined) observed.fp = fp;
    failedAt.delete(id);
    scheduleFlush();
  }

  /** Read the queued Sessions, one at a time. */
  function work() {
    working ??= (async () => {
      try {
        await ready();
        while (queue.size > 0 && !closing) {
          const id = queue.values().next().value;
          queue.delete(id);
          try {
            await syncSession(id);
          } catch (error) {
            failedAt.set(id, now());
            warn(`could not read session ${id}: ${String(error?.message ?? error)}`);
          }
        }
      } catch {
        /* the ledger could not be loaded: the queue waits for the next request */
      } finally {
        working = null;
      }
    })();
    return working;
  }

  function requestSync(id) {
    const failed = failedAt.get(id);
    if (failed !== undefined && now() - failed < RETRY_MS) return;
    queue.add(id);
    if (syncTimer !== null || working !== null) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void work();
    }, syncDelayMs);
    syncTimer.unref?.();
  }

  function onEvent(sessionId, event) {
    if (closing || typeof sessionId !== "string" || sessionId.length === 0 || !isRecord(event) || !Number.isSafeInteger(event.seq)) return;
    if (ledger === null) {
      requestSync(sessionId);
      return;
    }
    const last = lastSeq(sessionId);
    if (last === undefined || event.seq > last + 1) {
      requestSync(sessionId);
      return;
    }
    if (event.seq <= last) return;
    const observed = observation(sessionId);
    observed.upTo = event.seq;
    const call = usageOf(event);
    if (call !== null) observed.items.push({ seq: event.seq, time: typeof event.time === "number" ? event.time : now(), ...call });
    scheduleFlush();
  }

  async function backfill(signal) {
    await ready();
    const store = persistence();
    if (typeof store?.list !== "function" || typeof query()?.readSession !== "function") return;
    Object.assign(progress, { running: true, total: 0, done: 0, failed: 0 });
    try {
      const listed = await store.list(signal === undefined ? undefined : { signal });
      const snapshots = Array.isArray(listed) ? listed : [];
      progress.total = snapshots.length;
      for (const snapshot of snapshots) {
        if (closing || signal?.aborted) break;
        const id = snapshot?.header?.id;
        const fp = fingerprint(snapshot);
        const known = typeof id === "string" && Object.hasOwn(ledger.sessions, id) ? ledger.sessions[id] : undefined;
        const unchanged = fp !== undefined && known?.fp === fp;
        if (typeof id === "string" && id.length > 0 && !unchanged && snapshot?.formatStatus !== "migration-required") {
          try {
            await syncSession(id, fp);
          } catch (error) {
            progress.failed += 1;
            warn(`could not read session ${id}: ${String(error?.message ?? error)}`);
          }
          await yieldTurn();
        }
        progress.done += 1;
      }
    } finally {
      progress.running = false;
      progress.finishedAt = now();
    }
    await flush();
  }

  /** The providers registered now (id → route name), or null when the list cannot be read. */
  function providerNames() {
    try {
      const listed = llm()?.listProviders?.();
      if (!Array.isArray(listed)) return null;
      const names = new Map();
      for (const entry of listed) {
        if (typeof entry?.id === "string" && entry.id.length > 0) names.set(entry.id, typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id);
      }
      return names;
    } catch {
      return null;
    }
  }

  async function stats(request = {}) {
    await ready();
    if (pending.size > 0) await flush();
    const figures = aggregate(ledger, { range: request.range, now: now(), names: providerNames() });
    return {
      ...figures,
      status: {
        importing: progress.running,
        imported: progress.done,
        toImport: progress.total,
        importFailed: progress.failed,
        importedAt: progress.finishedAt,
        writeFailed: lastWriteError !== null,
        generatedAt: now(),
      },
    };
  }

  async function whenIdle() {
    for (let round = 0; round < 20; round += 1) {
      if (syncTimer !== null) {
        clearTimeout(syncTimer);
        syncTimer = null;
        void work();
      }
      if (working !== null) await working;
      await flush();
      if (queue.size === 0 && working === null && pending.size === 0) return;
    }
  }

  async function close() {
    closing = true;
    if (syncTimer !== null) clearTimeout(syncTimer);
    syncTimer = null;
    await flush();
  }

  return { onEvent, backfill, stats, flush, whenIdle, close, ready };
}
