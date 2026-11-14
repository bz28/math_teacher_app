/**
 * A tiny cache of per-submission fetches, so the review page doesn't
 * re-download a student's work when the teacher clicks back to them
 * (A → B → A).
 *
 * Correctness comes first: a cached value is only ever served against
 * the exact `version` it was fetched under. The review page passes the
 * roster row object, and every change to a submission made from that
 * page (a grade save, approve, regrade, reopen, a poll that saw a new
 * grade land) replaces that row with a new object — so a change makes
 * the cached copy unreachable without each call site having to
 * remember to invalidate. Entries also expire after `ttlMs` from when
 * their fetch STARTED, which bounds how long a change made somewhere
 * else (another tab, the grading queue) can go unseen, and only the
 * last `capacity` submissions are kept.
 *
 * Only successes are cached; a failed load is dropped so the next look
 * retries. A load for the same id and version that's still in flight is
 * joined rather than repeated.
 */
export interface DetailCache<T> {
  /** The cached value for `id` if it was fetched under `version` and is
   *  still fresh; otherwise undefined. */
  get(id: string, version: unknown): T | undefined;
  /** The cached (or in-flight) value for `id` at `version`, or a new
   *  `load()` whose result is cached when `keep` allows. */
  load(id: string, version: unknown, load: () => Promise<T>): Promise<T>;
  /** True when `value` is the very object cached for `id` — i.e. it
   *  hasn't been edited locally since it came from the server. */
  holds(id: string, value: T): boolean;
  invalidate(id: string): void;
  clear(): void;
}

interface Entry<T> {
  version: unknown;
  startedAt: number;
  promise: Promise<T>;
  settled: boolean;
  value?: T;
}

export function createDetailCache<T>({
  capacity = 5,
  ttlMs = 60_000,
  keep = () => true,
  now = Date.now,
}: {
  capacity?: number;
  ttlMs?: number;
  /** Whether a loaded value may be served again. A value that's still
   *  changing on the server (a check in progress) shouldn't be. */
  keep?: (value: T) => boolean;
  now?: () => number;
} = {}): DetailCache<T> {
  // Map iteration order is insertion order: re-inserting on use makes
  // the first key the least recently used.
  const entries = new Map<string, Entry<T>>();

  const live = (id: string, version: unknown): Entry<T> | undefined => {
    const e = entries.get(id);
    if (!e) return undefined;
    if (e.version !== version || now() - e.startedAt > ttlMs) {
      entries.delete(id);
      return undefined;
    }
    return e;
  };

  const touch = (id: string, e: Entry<T>) => {
    entries.delete(id);
    entries.set(id, e);
    while (entries.size > capacity) {
      entries.delete(entries.keys().next().value as string);
    }
  };

  return {
    get(id, version) {
      const e = live(id, version);
      return e?.settled ? e.value : undefined;
    },
    load(id, version, load) {
      const hit = live(id, version);
      if (hit) {
        touch(id, hit);
        return hit.promise;
      }
      const entry = { version, startedAt: now(), settled: false } as Entry<T>;
      entry.promise = load().then(
        (value) => {
          // Invalidated, evicted or superseded while in flight: hand the
          // value to whoever asked, but don't keep it.
          if (entries.get(id) === entry) {
            if (keep(value)) {
              entry.settled = true;
              entry.value = value;
            } else {
              entries.delete(id);
            }
          }
          return value;
        },
        (err: unknown) => {
          if (entries.get(id) === entry) entries.delete(id);
          throw err;
        },
      );
      touch(id, entry);
      return entry.promise;
    },
    holds(id, value) {
      const e = entries.get(id);
      return !!e && e.settled && e.value === value;
    },
    invalidate(id) {
      entries.delete(id);
    },
    clear() {
      entries.clear();
    },
  };
}
