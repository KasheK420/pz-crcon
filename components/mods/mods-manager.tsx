"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/pz/panel";
import { LiveDot } from "@/components/pz/live-dot";
import { Button } from "@/components/ui/button";
import { csrfFetch } from "@/lib/csrf/fetch";
import type { Role } from "@/lib/auth/role";
import { AddModForm } from "./add-mod-form";
import { ImportCollectionDialog } from "./import-collection-dialog";

interface ModRow {
  id: string;
  workshopId: string;
  modId: string;
  name: string;
  thumbnailUrl: string | null;
  version: string | null;
  enabled: boolean;
  loadOrder: number;
  installedAt: string;
  updatedAt: string;
}

interface ApiListResponse {
  ok: true;
  mods: ModRow[];
  expectedIniWorkshopItems: string;
  expectedIniMods: string;
  iniWorkshopItems: string | null;
  iniMods: string | null;
  iniPath: string;
  iniMtimeMs: number | null;
  iniDrift: boolean;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function workshopUrl(id: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
}

export function ModsManager({ role }: { role: Role }) {
  const canEdit = role === "ADMIN" || role === "OWNER";
  const [data, setData] = useState<ApiListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/mods", { cache: "no-store" });
      if (res.ok) {
        setData((await res.json()) as ApiListResponse);
      } else {
        toast.error(`Mod list fetch failed: ${res.status}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggle(row: ModRow, enabled: boolean) {
    setBusy(row.id);
    try {
      const res = await csrfFetch(`/api/admin/mods/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Toggle failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(`${enabled ? "Enabled" : "Disabled"} ${row.name}`);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: ModRow) {
    if (!confirm(`Remove ${row.name} (${row.workshopId}) from the server?`)) {
      return;
    }
    setBusy(row.id);
    try {
      const res = await csrfFetch(`/api/admin/mods/${row.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Remove failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(`Removed ${row.name}`);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function move(row: ModRow, direction: -1 | 1) {
    if (!data) return;
    const sorted = [...data.mods].sort((a, b) => a.loadOrder - b.loadOrder);
    const idx = sorted.findIndex((m) => m.id === row.id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
    const next = [...sorted];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setBusy(row.id);
    try {
      const res = await csrfFetch("/api/admin/mods/reorder", {
        method: "PUT",
        body: JSON.stringify({ orderedIds: next.map((m) => m.id) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Reorder failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function applyIni() {
    setBusy("__apply__");
    try {
      const res = await csrfFetch("/api/admin/mods/sync", {
        method: "POST",
        body: JSON.stringify({ action: "apply-ini" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Apply failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success("INI synced — restart required for mods to load.");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function refreshSteam() {
    setBusy("__steam__");
    try {
      const res = await csrfFetch("/api/admin/mods/sync", {
        method: "POST",
        body: JSON.stringify({ action: "refresh-steam" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Refresh failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(`Refreshed ${j.refreshed} mod(s), ${j.missed} missed.`);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const all = [...data.mods].sort((a, b) => a.loadOrder - b.loadOrder);
    if (!filter.trim()) return all;
    const q = filter.toLowerCase();
    return all.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.workshopId.includes(q) ||
        m.modId.toLowerCase().includes(q),
    );
  }, [data, filter]);

  const enabledCount = data ? data.mods.filter((m) => m.enabled).length : 0;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Mods"
        sub={data ? `${enabledCount}/${data.mods.length} ENABLED` : undefined}
        right={
          <div className="flex items-center gap-2">
            <LiveDot
              variant={loading ? "warn" : data?.iniDrift ? "down" : "live"}
              label={loading ? "LOADING" : data?.iniDrift ? "DRIFT" : "SYNCED"}
            />
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="pz-pill cursor-pointer"
            >
              {loading ? "..." : "REFRESH"}
            </button>
          </div>
        }
        dense
        bodyClassName="p-0"
      >
        <div className="p-3 border-b border-pz-border-lo flex flex-col gap-3">
          <div className="bg-pz-bg-1 border border-pz-border-lo px-3 py-2 text-[12px] text-pz-text-dim">
            <strong className="text-pz-text">How it works.</strong> Adding a mod upserts
            the Prisma row, rewrites <code className="pz-mono">WorkshopItems=</code> and{" "}
            <code className="pz-mono">Mods=</code> in the live{" "}
            <code className="pz-mono">.ini</code>, and takes effect after the next PZ
            server restart. Disabling a mod removes it from the INI next apply — its
            history stays in the DB so you can re-enable later.
          </div>

          {data?.iniDrift && canEdit && (
            <div className="bg-pz-amber/15 border border-pz-amber text-pz-text text-[12px] px-3 py-2 flex items-center gap-3 flex-wrap">
              <strong className="pz-display-h text-pz-amber">INI out of sync.</strong>
              <span className="flex-1">
                DB state doesn&apos;t match the live{" "}
                <code className="pz-mono">{data.iniPath}</code>. Click apply to write, then
                restart the server to load.
              </span>
              <Button
                size="sm"
                onClick={applyIni}
                disabled={busy === "__apply__"}
              >
                {busy === "__apply__" ? "..." : "Apply to INI"}
              </Button>
            </div>
          )}

          {canEdit && <AddModForm onAdded={refresh} />}

          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="flex-1 max-w-[400px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
              placeholder="search name / workshop id / mod id..."
            />
            {canEdit && <ImportCollectionDialog onImported={refresh} />}
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={refreshSteam}
                disabled={busy === "__steam__"}
              >
                {busy === "__steam__" ? "..." : "Refresh from Steam"}
              </Button>
            )}
          </div>
        </div>

        {!data && <div className="p-6 text-center text-pz-muted text-xs">Loading…</div>}
        {data && rows.length === 0 && (
          <div className="p-6 text-center text-pz-muted text-xs">
            {data.mods.length === 0
              ? "No mods installed yet. Add a Workshop URL or ID above."
              : "No entries match the filter."}
          </div>
        )}
        {data && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="pz-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th style={{ width: 48 }} />
                  <th>Name</th>
                  <th>Workshop</th>
                  <th>Mod ID</th>
                  <th>Status</th>
                  <th>Added</th>
                  {canEdit && <th>Order</th>}
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((m, idx) => (
                  <tr key={m.id} className={!m.enabled ? "opacity-55" : ""}>
                    <td className="pz-mono text-[10px] text-pz-muted">{idx + 1}</td>
                    <td>
                      {m.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          width={40}
                          height={40}
                          className="object-cover border border-pz-border-lo"
                        />
                      ) : (
                        <div
                          className="w-10 h-10 bg-pz-bg-0 border border-pz-border-lo grid place-items-center pz-mono text-[9px] text-pz-muted"
                          aria-hidden
                        >
                          N/A
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="font-medium text-pz-text max-w-[320px] line-clamp-2">
                        {m.name}
                      </div>
                    </td>
                    <td className="pz-mono text-[11px] text-pz-text-dim">
                      <a
                        href={workshopUrl(m.workshopId)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-pz-primary underline hover:opacity-75"
                      >
                        {m.workshopId}
                      </a>
                    </td>
                    <td className="pz-mono text-[11px] text-pz-text-dim">{m.modId}</td>
                    <td>
                      {m.enabled ? (
                        <span className="pz-badge green">● ENABLED</span>
                      ) : (
                        <span className="pz-badge">DISABLED</span>
                      )}
                    </td>
                    <td className="pz-mono text-[11px] text-pz-muted">
                      {relTime(m.installedAt)}
                    </td>
                    {canEdit && (
                      <td>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => move(m, -1)}
                            disabled={busy !== null || idx === 0}
                            className="pz-pill cursor-pointer disabled:opacity-40"
                            aria-label="Move up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => move(m, 1)}
                            disabled={busy !== null || idx === rows.length - 1}
                            className="pz-pill cursor-pointer disabled:opacity-40"
                            aria-label="Move down"
                          >
                            ↓
                          </button>
                        </div>
                      </td>
                    )}
                    {canEdit && (
                      <td className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggle(m, !m.enabled)}
                          disabled={busy === m.id}
                        >
                          {busy === m.id ? "..." : m.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(m)}
                          disabled={busy === m.id}
                        >
                          Remove
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
