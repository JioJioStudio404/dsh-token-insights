/**
 * The plugin's own file: read strictly, written atomically, one writer at a time across processes.
 *
 * - {@link readJsonFile}: a missing file is empty; a file that is there but cannot be read (permission, a lock, a disk
 *   error) throws, so nothing writes over it as if it were empty; a file that holds no valid JSON is set aside beside
 *   it (`<file>.corrupt-<time>`) and read as empty.
 * - {@link withFileLock}: writes from several processes on one DeepSeek Harness home (the desktop host, the terminal)
 *   serialized by a lock file beside the store.
 * - {@link writeJsonFile}: written to a temporary file beside the store, then renamed over it, so a crash never leaves
 *   half a file.
 *
 * The read and lock helpers are the ones dsh-cn-models uses for its stores.
 *
 * @module dsh-token-insights/files
 */
import { dirname } from "node:path";

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Transient errors Windows reports for a file another process holds this instant (they clear within milliseconds). */
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const removeQuietly = async (fs, path) => {
  try {
    await (typeof fs.rm === "function" ? fs.rm(path, { force: true }) : fs.unlink(path));
  } catch {
    /* gone already, or held: a stale lock is broken by the next writer */
  }
};

/** The name a corrupt store file is set aside under. */
export const corruptName = (file, now = Date.now()) => `${file}.corrupt-${new Date(now).toISOString().replace(/[:.]/g, "-")}`;

/**
 * A store file's JSON object, read strictly: null when the file is missing or empty; a read error other than a
 * missing file throws (after a few quick retries of a transient one), so the caller neither caches nor writes an
 * empty state over a file it could not read. A file whose text is not a JSON object is renamed aside
 * ({@link corruptName}: kept for the user, never overwritten) and read as empty; when it cannot be set aside, the
 * read throws.
 * @param {object} fs - `node:fs/promises` or a test double.
 * @param {string} file - the store's path.
 * @returns {Promise<object | null>}
 */
export async function readJsonFile(fs, file) {
  let text;
  for (let attempt = 0; ; attempt += 1) {
    try {
      text = await fs.readFile(file, "utf8");
      break;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (!BUSY.has(error?.code) || attempt >= 4) throw error;
      await sleep(10 * (attempt + 1));
    }
  }
  if (String(text ?? "").trim() === "") return null;
  const value = safeJson(text);
  if (isRecord(value)) return value;
  await fs.rename(file, corruptName(file));
  return null;
}

/** A lock older than this was left by a process that ended without releasing it: it is broken. */
export const LOCK_STALE_MS = 10_000;
/** How long a write waits for another process's lock before it fails (the caller keeps what it would write). */
export const LOCK_WAIT_MS = 15_000;

/**
 * Run `fn` holding the store's lock file (`<file>.lock`, created exclusively): another process writing the same store
 * waits, so neither writes over what the other just wrote. The holder touches the lock while it works; a lock left
 * untouched for {@link LOCK_STALE_MS} (its process ended or hangs) is broken. A holder removes the lock only while it
 * is still its own (it names the holder). Without `fs.open` (a test double) `fn` runs unlocked.
 */
export async function withFileLock(fs, file, fn, { staleMs = LOCK_STALE_MS, waitMs = LOCK_WAIT_MS } = {}) {
  if (typeof fs?.open !== "function") return fn();
  const lock = `${file}.lock`;
  const owner = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const started = Date.now();
  let handle;
  await fs.mkdir(dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      handle = await fs.open(lock, "wx", 0o600);
      try {
        await handle.writeFile(owner, "utf8");
      } catch {
        /* the lock holds without its name; it is then removed on release regardless */
      }
      break;
    } catch (error) {
      if (error?.code !== "EEXIST" && !(BUSY.has(error?.code) && attempt < 20)) throw error;
      let info;
      try {
        info = await fs.stat(lock);
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() - info.mtimeMs > staleMs) {
        await removeQuietly(fs, lock);
        continue;
      }
      if (Date.now() - started > waitMs) {
        const busy = new Error(`store locked by another process: ${lock}`);
        busy.code = "ELOCKED";
        throw busy;
      }
      await sleep(Math.min(100, 10 + attempt * 5));
    }
  }
  // Touched while `fn` works, so a long write is never taken for a lock left behind.
  const beat = setInterval(() => {
    const now = new Date();
    Promise.resolve(typeof handle.utimes === "function" ? handle.utimes(now, now) : fs.utimes?.(lock, now, now)).catch(() => undefined);
  }, Math.max(20, Math.floor(staleMs / 4)));
  beat.unref?.();
  try {
    return await fn();
  } finally {
    clearInterval(beat);
    await handle.close().catch(() => undefined);
    // Another process broke this lock (this one hung past the stale time) and holds its own now: that one stays.
    let current = owner;
    try {
      current = await fs.readFile(lock, "utf8");
    } catch {
      /* gone, or unreadable: removed as ours */
    }
    if (current === owner || current === "") await removeQuietly(fs, lock);
  }
}

/**
 * Write a JSON value: to `<file>.<pid>.tmp` first, then renamed over the store (a busy rename is retried briefly).
 * @param {object} fs - `node:fs/promises` or a test double.
 * @param {string} file - the store's path.
 * @param {unknown} value - what to write.
 */
export async function writeJsonFile(fs, file, value) {
  await fs.mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value)}
`, { encoding: "utf8", mode: 0o600 });
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temporary, file);
      return;
    } catch (error) {
      if (!BUSY.has(error?.code) || attempt >= 6) {
        await removeQuietly(fs, temporary);
        throw error;
      }
      await sleep(15 * (attempt + 1));
    }
  }
}
