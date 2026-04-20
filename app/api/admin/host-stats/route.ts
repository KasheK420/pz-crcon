import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getContainerStats } from "@/lib/docker/client";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "api/host-stats" });

export const dynamic = "force-dynamic";

const PZ_SERVER_NAME = process.env.PZ_SERVER_CONTAINER ?? "pz-server";
const PZ_CRCON_NAME = process.env.PZ_CRCON_CONTAINER ?? "pz-crcon";

interface StatsBlob {
  name: string;
  running: boolean;
  memBytes: number;
  memLimitBytes: number;
  cpuPercent: number;
  available: boolean;
  reason?: string;
}

async function safeStats(name: string): Promise<StatsBlob> {
  try {
    const s = await getContainerStats(name);
    if (!s) {
      return {
        name,
        running: false,
        memBytes: 0,
        memLimitBytes: 0,
        cpuPercent: 0,
        available: false,
        reason: "container not found",
      };
    }
    return { ...s, available: true };
  } catch (e) {
    log().warn({ err: e, container: name }, "host-stats fetch failed");
    return {
      name,
      running: false,
      memBytes: 0,
      memLimitBytes: 0,
      cpuPercent: 0,
      available: false,
      reason: (e as Error).message,
    };
  }
}

export async function GET() {
  try {
    await requireRole("VIEWER");
  } catch (e) {
    const status = (e as Error).message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  const [pzServer, pzCrcon] = await Promise.all([
    safeStats(PZ_SERVER_NAME),
    safeStats(PZ_CRCON_NAME),
  ]);

  return NextResponse.json({
    pzServer,
    pzCrcon,
    ts: Date.now(),
  });
}
