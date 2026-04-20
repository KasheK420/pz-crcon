/**
 * GET /api/admin/server/state
 *
 * Snapshot used by `<ServerControlsCard>` to decide button enablement
 * (and by `<LifecyclePhaseBadge>` as a fallback when the WS is down).
 *
 * Returns:
 *   {
 *     ok: true,
 *     containerState: "running" | "exited" | "unknown",
 *     containerExitCode?: number,
 *     rconOnline: boolean,
 *     lifecyclePhase: Phase,
 *     lifecycleDetail?: string,
 *     proxyReachable: boolean,
 *     uptimeSec: number
 *   }
 *
 * VIEWER+. No CSRF (read-only GET).
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { getDetail, getPhase } from "@/lib/server/lifecycle";
import { inspectPz, isProxyReachable } from "@/lib/docker/control";
import { rconPing } from "@/lib/rcon/server-commands";
import { getFirstConnectAt } from "@/lib/rcon/client";

export const dynamic = "force-dynamic";

const PROCESS_STARTED_AT = Date.now();

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER")) {
    return NextResponse.json(
      { ok: false, code: "forbidden" },
      { status: 403 },
    );
  }

  const proxyReachable = await isProxyReachable();
  let containerState: "running" | "exited" | "unknown" = "unknown";
  let containerExitCode: number | undefined;
  if (proxyReachable) {
    const info = await inspectPz();
    if (info) {
      containerState = info.running ? "running" : "exited";
      containerExitCode = info.exitCode;
    }
  }

  // RCON ping is cheap and bounded (2s timeout inside rconPing) — fine
  // to call synchronously. If the container isn't running, skip it.
  const rconOnline =
    containerState === "running" ? await rconPing(2_000) : false;

  const firstConnectAt = getFirstConnectAt();
  const uptimeSec = Math.floor(
    (Date.now() - (firstConnectAt ?? PROCESS_STARTED_AT)) / 1000,
  );

  return NextResponse.json({
    ok: true,
    containerState,
    containerExitCode,
    rconOnline,
    lifecyclePhase: getPhase(),
    lifecycleDetail: getDetail(),
    proxyReachable,
    uptimeSec,
    ts: Date.now(),
  });
}
