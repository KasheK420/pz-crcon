/**
 * Schedule action executors.
 *
 * Each schedule has a `kind` string that maps to one of these functions.
 * They are invoked by the runner when a cron expression matches, with the
 * schedule's JSON payload as context.
 *
 * All handlers return a structured outcome — never throw — so the runner
 * can log a single line per tick without try/catch noise.
 */

import { createBackup } from "@/lib/pz/backups";
import { gracefulRestart, getPhase } from "@/lib/server/lifecycle";
import { servermsg } from "@/lib/rcon/server-commands";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "schedules/actions" });

export type ScheduleKind =
  | "announce"
  | "restart"
  | "restart-warn"
  | "auto-backup";

export interface AnnouncePayload {
  message: string;
}

export interface RestartPayload {
  announceBefore?: boolean;
}

export interface RestartWarnPayload {
  /** Total warning window in minutes (e.g. 10 → warn starts 10 min before restart). */
  warnMinutes?: number;
  /** Extra warning breakpoints in minutes (e.g. [5, 1] for "5 min left", "1 min left"). */
  breakpoints?: number[];
  /** Optional shutdown reason text. */
  reason?: string;
}

export interface AutoBackupPayload {
  notes?: string;
}

export type SchedulePayload =
  | ({ kind: "announce" } & AnnouncePayload)
  | ({ kind: "restart" } & RestartPayload)
  | ({ kind: "restart-warn" } & RestartWarnPayload)
  | ({ kind: "auto-backup" } & AutoBackupPayload);

export interface ActionOutcome {
  ok: boolean;
  detail: string;
}

export const SCHEDULE_KINDS: ScheduleKind[] = [
  "announce",
  "restart",
  "restart-warn",
  "auto-backup",
];

export async function runAnnounce(p: AnnouncePayload): Promise<ActionOutcome> {
  if (!p.message?.trim()) {
    return { ok: false, detail: "empty announce payload" };
  }
  try {
    await servermsg(p.message);
    return { ok: true, detail: `announced: ${p.message.slice(0, 80)}` };
  } catch (e) {
    return { ok: false, detail: `announce failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function runRestart(p: RestartPayload): Promise<ActionOutcome> {
  if (getPhase() !== "idle") {
    return {
      ok: false,
      detail: `skipped: lifecycle busy (phase=${getPhase()})`,
    };
  }
  if (p.announceBefore) {
    try {
      await servermsg("Server restart now — sit tight.");
    } catch {
      // Best-effort; a restart while RCON is down is still a restart.
    }
  }
  try {
    // 5s warning window so the player gets a final countdown even on
    // unscheduled restarts invoked without a prior warn.
    await gracefulRestart(5);
    return { ok: true, detail: `restarted (phase=${getPhase()})` };
  } catch (e) {
    return {
      ok: false,
      detail: `restart threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function runRestartWarn(p: RestartWarnPayload): Promise<ActionOutcome> {
  const warnMinutes = p.warnMinutes ?? 10;
  const breakpoints = (p.breakpoints ?? [5, 1]).filter(
    (x) => x > 0 && x < warnMinutes,
  );
  const reason = p.reason?.trim() || "scheduled restart";
  try {
    await servermsg(`Server ${reason} in ${warnMinutes} minutes. Get to safety.`);
  } catch {
    // Continue — the restart runs regardless.
  }
  for (const bp of breakpoints.sort((a, b) => b - a)) {
    const delayMs = Math.max(0, (warnMinutes - bp) * 60_000 - 0);
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      await servermsg(`Server ${reason} in ${bp} minute(s).`);
    } catch {
      // ignore
    }
  }
  // Wait out the tail up to the full `warnMinutes` window.
  const lastBp = breakpoints.length > 0 ? Math.min(...breakpoints) : warnMinutes;
  const tailMs = Math.max(0, lastBp * 60_000);
  await new Promise((r) => setTimeout(r, tailMs));
  return runRestart({ announceBefore: false });
}

export async function runAutoBackup(
  p: AutoBackupPayload,
): Promise<ActionOutcome> {
  const res = await createBackup({
    kind: "AUTO",
    userId: null,
    notes: p.notes ?? "scheduled auto-backup",
  });
  if (!res.ok) {
    return { ok: false, detail: `backup failed: ${res.code} ${res.detail}` };
  }
  return {
    ok: true,
    detail: `backup created: ${res.row.filename} (${res.row.sizeBytes} bytes)`,
  };
}

export async function runAction(
  kind: string,
  payload: Record<string, unknown>,
): Promise<ActionOutcome> {
  try {
    switch (kind as ScheduleKind) {
      case "announce":
        return runAnnounce(payload as unknown as AnnouncePayload);
      case "restart":
        return runRestart(payload as unknown as RestartPayload);
      case "restart-warn":
        return runRestartWarn(payload as unknown as RestartWarnPayload);
      case "auto-backup":
        return runAutoBackup(payload as unknown as AutoBackupPayload);
      default:
        return { ok: false, detail: `unknown schedule kind: ${kind}` };
    }
  } catch (e) {
    log().error({ err: e, kind }, "schedule action threw");
    return { ok: false, detail: `uncaught: ${e instanceof Error ? e.message : String(e)}` };
  }
}
