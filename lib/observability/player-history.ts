/**
 * In-memory ring buffer of player-count samples for the overview sparkline.
 *
 * We intentionally do NOT persist this — a 24 h history at 5 min
 * resolution is 288 numbers, and the overview widget only needs the
 * *shape* of the curve, not exact long-term data. Losing it on a
 * container restart is acceptable (the ring starts refilling immediately
 * from the poll loop).
 *
 * The buffer is lazily sampled: every call to `recordSample()` adds a
 * slot iff the clock has crossed a `SAMPLE_INTERVAL_MS` boundary since
 * the last recorded sample. `/api/status` calls `recordSample()` on
 * each hit, so the buffer stays warm as long as the overview page is
 * open (10 s poll). If nobody is viewing the panel, samples stop — we
 * accept that gap rather than run a background timer just for this.
 */

const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const CAPACITY = Math.ceil(WINDOW_MS / SAMPLE_INTERVAL_MS); // 288

interface Sample {
  ts: number;
  count: number;
}

const samples: Sample[] = [];
let lastSampleAt = 0;

export function recordSample(count: number): void {
  const now = Date.now();
  if (now - lastSampleAt < SAMPLE_INTERVAL_MS) return;
  lastSampleAt = now;
  samples.push({ ts: now, count });
  // Evict oldest
  while (samples.length > CAPACITY) samples.shift();
}

export function historyView(): {
  samples: Sample[];
  intervalMs: number;
  windowMs: number;
  capacity: number;
} {
  return {
    samples: samples.slice(),
    intervalMs: SAMPLE_INTERVAL_MS,
    windowMs: WINDOW_MS,
    capacity: CAPACITY,
  };
}

/** Testing helper — resets the in-memory buffer. */
export function __resetPlayerHistoryForTests(): void {
  samples.length = 0;
  lastSampleAt = 0;
}
