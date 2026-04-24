/**
 * Schedule runner — minute-granularity tick that dispatches actions when a
 * schedule's cron expression matches wall-clock minute.
 *
 * Design notes:
 *   - Run loop lives on the long-running WS server process
 *     (`server/ws.ts`). There is exactly one runner per container; if
 *     pz-crcon is replicated in the future, the DB row's `lastRunAt`
 *     acts as a leader check (whoever writes first wins).
 *   - We don't try to catch up missed minutes after a restart — the
 *     runner fires for the *current* minute only. A server that was
 *     down at 04:00 simply skips that tick; the next match fires
 *     tomorrow at 04:00.
 *   - `nextRunAt` is maintained as telemetry only — the matcher uses
 *     the current-minute match, never consumes `nextRunAt`. That
 *     decouples the two so clock drift / DST edges don't cause
 *     duplicate fires.
 *   - `lastRunAt` inside the current minute prevents double-firing
 *     when the tick coincidentally overlaps with the matched minute
 *     boundary (we round down to the minute when comparing).
 */

import { prisma } from "@/lib/db/client";
import type { Schedule } from "@prisma/client";
import { matchesCron, nextFireAt, parseCron } from "./cron";
import { runAction } from "./actions";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "schedules/runner" });

const TICK_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

function startOfMinute(d: Date | string): number {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate(), x.getHours(), x.getMinutes()).getTime();
}

async function tick(): Promise<void> {
  if (running) {
    // Previous tick still running — skip to avoid pile-up. Happens when
    // a restart action takes > 60 s (which is typical).
    log().debug("tick skipped: previous tick still running");
    return;
  }
  running = true;
  try {
    const now = new Date();
    const schedules = await prisma.schedule.findMany({
      where: { enabled: true },
    });
    for (const s of schedules) {
      await tickOne(s, now);
    }
  } catch (e) {
    log().error({ err: e instanceof Error ? e.message : String(e) }, "tick failed");
  } finally {
    running = false;
  }
}

async function tickOne(s: Schedule, now: Date): Promise<void> {
  const parsed = parseCron(s.cronExpr);
  if (!parsed.ok) {
    log().warn({ id: s.id, name: s.name, err: parsed.error }, "cron parse failed");
    return;
  }
  if (!matchesCron(parsed, now)) return;
  // Debounce: did we already fire this minute?
  if (s.lastRunAt && startOfMinute(s.lastRunAt) === startOfMinute(now)) {
    return;
  }
  const payload = (s.payload as Record<string, unknown>) ?? {};
  log().info({ id: s.id, name: s.name, kind: s.kind }, "firing schedule");
  const outcome = await runAction(s.kind, payload);
  const next = nextFireAt(parsed, new Date(Date.now() + 60_000));
  await prisma.schedule
    .update({
      where: { id: s.id },
      data: {
        lastRunAt: now,
        nextRunAt: next ?? null,
      },
    })
    .catch(() => {});
  log().info(
    { id: s.id, name: s.name, ok: outcome.ok, detail: outcome.detail },
    "schedule finished",
  );
}

/** Start the runner. Idempotent — no-op if already started. */
export function startScheduleRunner(): void {
  if (timer !== null) return;
  // Align first tick to the next minute boundary so all schedules
  // compare against the same wall clock.
  const now = Date.now();
  const msToNextMinute = 60_000 - (now % 60_000);
  setTimeout(() => {
    void tick();
    timer = setInterval(() => {
      void tick();
    }, TICK_MS);
  }, msToNextMinute);
  log().info({ alignInMs: msToNextMinute }, "schedule runner aligned, will start");
}

export function stopScheduleRunner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Test/manual-invoke helper: fire a single schedule now. */
export async function fireScheduleNow(id: string): Promise<{
  ok: boolean;
  detail: string;
}> {
  const s = await prisma.schedule.findUnique({ where: { id } });
  if (!s) return { ok: false, detail: "not-found" };
  const payload = (s.payload as Record<string, unknown>) ?? {};
  const outcome = await runAction(s.kind, payload);
  await prisma.schedule
    .update({
      where: { id },
      data: { lastRunAt: new Date() },
    })
    .catch(() => {});
  return outcome;
}
