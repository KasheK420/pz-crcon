/**
 * Minimal 5-field cron parser sufficient for panel-scheduled ops:
 * `minute hour day-of-month month day-of-week`.
 *
 * Supported field syntax:
 *   - `*`          → any value in the field's range
 *   - `N`          → literal integer
 *   - `N-M`        → inclusive range
 *   - `*\/N`       → step of N from the field's minimum
 *   - `A,B,C`      → explicit list (combinations of the above)
 *
 * Not supported (intentionally): `@reboot` macros, L/# day-of-week
 * modifiers, names ("mon", "sat"), seconds field. Keep this simple —
 * operators who need fancier schedules can run two entries.
 *
 * Matching is done against the local timezone of the Node process (the
 * container is `Etc/UTC` by default, so `0 4 * * *` means 04:00 UTC).
 * Document this at the UI level; don't try to guess timezones here.
 */

export interface CronParseResult {
  ok: true;
  fields: [number[], number[], number[], number[], number[]];
}

export interface CronParseError {
  ok: false;
  error: string;
}

const RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day-of-month
  [1, 12], // month
  [0, 6], // day-of-week (0=Sunday)
];

function parseField(raw: string, [min, max]: [number, number]): number[] | null {
  const parts = raw.split(",").map((s) => s.trim());
  const set = new Set<number>();
  for (const part of parts) {
    if (part === "*") {
      for (let v = min; v <= max; v++) set.add(v);
      continue;
    }
    // Step: `*/N` or `A-B/N`
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const stride = Number(stepMatch[2]);
      if (!Number.isInteger(stride) || stride <= 0) return null;
      const [from, to] = parseRange(stepMatch[1], [min, max]) ?? [null, null];
      if (from === null || to === null) return null;
      for (let v = from; v <= to; v += stride) set.add(v);
      continue;
    }
    // Range or single int
    const rng = parseRange(part, [min, max]);
    if (!rng) return null;
    for (let v = rng[0]; v <= rng[1]; v++) set.add(v);
  }
  if (set.size === 0) return null;
  return Array.from(set).sort((a, b) => a - b);
}

function parseRange(
  s: string,
  [min, max]: [number, number],
): [number, number] | null {
  if (s === "*") return [min, max];
  const m = s.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] !== undefined ? Number(m[2]) : from;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < min || from > max) return null;
  if (to < min || to > max) return null;
  if (to < from) return null;
  return [from, to];
}

export function parseCron(expr: string): CronParseResult | CronParseError {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { ok: false, error: "expected 5 fields (minute hour dom month dow)" };
  }
  const fields: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const r = parseField(parts[i], RANGES[i]);
    if (!r) {
      return {
        ok: false,
        error: `field ${i + 1} ("${parts[i]}") is not parseable`,
      };
    }
    fields.push(r);
  }
  return { ok: true, fields: fields as CronParseResult["fields"] };
}

export function matchesCron(expr: CronParseResult, date: Date): boolean {
  const [m, h, dom, mon, dow] = expr.fields;
  return (
    m.includes(date.getMinutes()) &&
    h.includes(date.getHours()) &&
    dom.includes(date.getDate()) &&
    mon.includes(date.getMonth() + 1) &&
    dow.includes(date.getDay())
  );
}

/**
 * Walk forward minute-by-minute from `from` for at most 366 days, returning
 * the next Date at which `expr` matches. `from` is rounded up to the next
 * whole minute so the returned time is strictly in the future when called
 * at a non-zero-second clock.
 */
export function nextFireAt(
  expr: CronParseResult,
  from: Date = new Date(),
): Date | null {
  const start = new Date(from);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const MAX_MIN = 366 * 24 * 60;
  for (let i = 0; i < MAX_MIN; i++) {
    if (matchesCron(expr, start)) return new Date(start);
    start.setMinutes(start.getMinutes() + 1);
  }
  return null;
}

export function describeCron(expr: string): string {
  const p = parseCron(expr);
  if (!p.ok) return `invalid: ${p.error}`;
  const labels = [
    p.fields[0].length === 60 ? "any minute" : `min=${p.fields[0].join(",")}`,
    p.fields[1].length === 24 ? "any hour" : `hr=${p.fields[1].join(",")}`,
    p.fields[2].length === 31 ? "any dom" : `dom=${p.fields[2].join(",")}`,
    p.fields[3].length === 12 ? "any month" : `mon=${p.fields[3].join(",")}`,
    p.fields[4].length === 7 ? "any dow" : `dow=${p.fields[4].join(",")}`,
  ];
  return labels.join(" · ");
}
