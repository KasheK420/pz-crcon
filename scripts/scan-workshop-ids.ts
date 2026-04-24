#!/usr/bin/env -S tsx
/**
 * scripts/scan-workshop-ids.ts
 *
 * After PZ has downloaded the Workshop items listed in `WorkshopItems=`,
 * scan the on-disk mod folders and update each `Mod.modId` row to match
 * the real id the author shipped in their `mod.info`. Then re-sync the
 * INI so `Mods=` ends up with names PZ can actually resolve at load
 * time.
 *
 * Why this is needed: at bulk-import time we derive a mod id from the
 * Steam *title* (because that's all the Workshop API returns). The
 * author's real folder name is often different (`03-MuldraughCity` vs
 * "Muldraugh City"). PZ's loader matches the `Mods=` names against
 * folder names on disk, so un-fixed ids get silently dropped.
 *
 * Layout we read from:
 *   /home/steam/pz-dedicated/steamapps/workshop/content/108600/<wid>/mods/<realId>/mod.info
 *
 * Multi-mod Workshop items: when a Workshop item ships multiple mods
 * we register the **first** one and warn about the rest (operators
 * who want the extras can manually add a second Mod row pointing at
 * the same `workshopId`).
 */

import { join } from "node:path";
import { prisma } from "../lib/db/client";
import { getDocker, readContainerFile } from "../lib/docker/client";
import { checkConfigAccess } from "../lib/pz/access-check";
import { syncIniFromDb } from "../lib/pz/mods";

// The Workshop content sits under /home/steam/pz-dedicated/... INSIDE
// the pz-server container (its `pz-server-files` volume), not under
// /pz-data. pz-crcon doesn't bind-mount that volume, so we use
// dockerode (same HTTP API the rest of the panel uses for container
// inspect / log tails) to list directories and read files over the
// Docker socket.
const PZ_SERVER_NAME = process.env.PZ_CONTAINER_NAME ?? "pz-server";
const WORKSHOP_ROOT =
  process.env.PZ_WORKSHOP_ROOT ??
  "/home/steam/pz-dedicated/steamapps/workshop/content/108600";

async function dockerRun(cmd: string[]): Promise<string | null> {
  const docker = getDocker();
  try {
    const c = docker.getContainer(PZ_SERVER_NAME);
    const session = await c.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = (await session.start({
      hijack: true,
      stdin: false,
    })) as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks);
    // Strip Docker's 8-byte multiplex frame headers (stdout=1, stderr=2).
    const out: Buffer[] = [];
    let i = 0;
    while (i + 8 <= raw.length) {
      const type = raw[i];
      if (type !== 0 && type !== 1 && type !== 2) {
        return raw.toString("utf8");
      }
      const size = raw.readUInt32BE(i + 4);
      const start = i + 8;
      const end = start + size;
      if (end > raw.length) break;
      if (type === 1 || type === 2) out.push(raw.subarray(start, end));
      i = end;
    }
    return Buffer.concat(out).toString("utf8");
  } catch (e) {
    process.stderr.write(
      `[scan-workshop-ids] dockerRun failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return null;
  }
}

async function pathExists(p: string): Promise<boolean> {
  const out = await dockerRun(["ls", "-1d", p]);
  return out !== null && out.trim().length > 0 && !out.includes("No such");
}

async function listDir(p: string): Promise<string[]> {
  const out = await dockerRun(["ls", "-1", p]);
  if (!out) return [];
  return out.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
}

async function readModInfoFile(p: string): Promise<string | null> {
  return readContainerFile(PZ_SERVER_NAME, p);
}

function parseModInfo(raw: string): { id?: string; name?: string } {
  const out: { id?: string; name?: string } = {};
  for (const line of raw.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k === "id") out.id = v;
    if (k === "name") out.name = v;
  }
  return out;
}

interface Found {
  workshopId: string;
  /** All (id, name) pairs encountered inside this Workshop item. */
  mods: Array<{ id: string; name: string | null; relPath: string }>;
}

async function scanWorkshopItem(wid: string): Promise<Found | null> {
  const modsDir = join(WORKSHOP_ROOT, wid, "mods");
  if (!(await pathExists(modsDir))) return null;
  const entries = await listDir(modsDir);
  const mods: Found["mods"] = [];
  for (const name of entries) {
    const info = join(modsDir, name, "mod.info");
    if (!(await pathExists(info))) continue;
    const raw = await readModInfoFile(info);
    if (raw === null) continue;
    const parsed = parseModInfo(raw);
    mods.push({
      id: parsed.id ?? name,
      name: parsed.name ?? null,
      relPath: name,
    });
  }
  return { workshopId: wid, mods };
}

async function main(): Promise<void> {
  if (!(await pathExists(WORKSHOP_ROOT))) {
    process.stderr.write(
      `[scan-workshop-ids] workshop root missing at ${WORKSHOP_ROOT}\n` +
        `                    (PZ hasn't downloaded any items yet?)\n`,
    );
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");

  const rows = await prisma.mod.findMany({
    where: { enabled: true },
    orderBy: { loadOrder: "asc" },
  });

  let updated = 0;
  let missing = 0;
  let multi = 0;
  for (const row of rows) {
    if (row.workshopId.startsWith("local-")) continue;
    const found = await scanWorkshopItem(row.workshopId);
    if (!found || found.mods.length === 0) {
      missing++;
      process.stderr.write(
        `[scan-workshop-ids] MISS  ${row.workshopId} (${row.modId}) — not downloaded yet\n`,
      );
      continue;
    }
    if (found.mods.length > 1) {
      multi++;
      process.stderr.write(
        `[scan-workshop-ids] MULTI ${row.workshopId} ships ${found.mods.length} mods — registering first: ${found.mods[0].id}\n`,
      );
    }
    const first = found.mods[0];
    if (first.id === row.modId && (first.name == null || first.name === row.name)) {
      continue;
    }
    process.stderr.write(
      `[scan-workshop-ids] UPDATE ${row.workshopId}: modId "${row.modId}" → "${first.id}"${
        first.name ? `, name "${row.name}" → "${first.name}"` : ""
      }\n`,
    );
    updated++;
    if (!dryRun) {
      await prisma.mod.update({
        where: { id: row.id },
        data: {
          modId: first.id,
          ...(first.name ? { name: first.name } : {}),
        },
      });
    }
  }

  process.stderr.write(
    `[scan-workshop-ids] scanned=${rows.length} updated=${updated} missing=${missing} multi=${multi} dryRun=${dryRun}\n`,
  );

  if (dryRun || updated === 0) {
    await prisma.$disconnect();
    return;
  }

  const access = await checkConfigAccess();
  if (!access.ok) {
    process.stderr.write(
      `[scan-workshop-ids] config dir not accessible: ${access.reason}\n`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }
  const sync = await syncIniFromDb();
  if (!sync.ok) {
    process.stderr.write(
      `[scan-workshop-ids] ini sync failed: ${sync.detail}\n`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }
  process.stderr.write(
    `[scan-workshop-ids] ini synced — restart PZ to reload with corrected mod ids\n`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write(
    `[scan-workshop-ids] uncaught: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`,
  );
  process.exit(1);
});
