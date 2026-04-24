"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/pz/panel";
import { LiveDot } from "@/components/pz/live-dot";
import { Button } from "@/components/ui/button";
import { csrfFetch } from "@/lib/csrf/fetch";
import type { Role } from "@/lib/auth/role";

interface BackupRow {
  id: string;
  filename: string;
  sizeBytes: number;
  kind: "AUTO" | "MANUAL" | "PRE_RESTART" | "PRE_MOD_UPDATE";
  modCount: number | null;
  createdAt: string;
  createdById: string | null;
  notes: string | null;
  exists: boolean;
}

interface ApiResponse {
  ok: true;
  rows: BackupRow[];
  orphans: Array<{ filename: string; sizeBytes: number; mtime: string }>;
  backupRoot: string;
  total: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function badgeForKind(kind: BackupRow["kind"]): string {
  switch (kind) {
    case "AUTO":
      return "pz-badge";
    case "MANUAL":
      return "pz-badge green";
    case "PRE_RESTART":
      return "pz-badge amber";
    case "PRE_MOD_UPDATE":
      return "pz-badge amber";
  }
}

export function BackupsManager({ role }: { role: Role }) {
  const isOwner = role === "OWNER";
  const isAdmin = role === "ADMIN" || isOwner;
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/backups", { cache: "no-store" });
      if (res.ok) {
        setData((await res.json()) as ApiResponse);
      } else {
        toast.error(`Backup list fetch failed: ${res.status}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function create() {
    setBusy("__create__");
    try {
      const res = await csrfFetch("/api/admin/backups", {
        method: "POST",
        body: JSON.stringify({
          kind: "MANUAL",
          notes: notes.trim() || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Create failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(
        `Backup created — ${formatBytes(j.row?.sizeBytes ?? 0)}${
          j.pruned?.length ? `, pruned ${j.pruned.length} auto` : ""
        }`,
      );
      setNotes("");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: BackupRow) {
    if (!confirm(`Permanently delete ${row.filename}?\n\nThis cannot be undone.`)) {
      return;
    }
    setBusy(row.id);
    try {
      const res = await csrfFetch(`/api/admin/backups/${row.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Delete failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(`Deleted ${row.filename}`);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function restore(row: BackupRow) {
    if (
      !confirm(
        `RESTORE ${row.filename}?\n\nThis will REPLACE the live world save and config files with this snapshot. The PZ server must be stopped first. Current state is renamed to a .pre-restore-<stamp> sibling so you can manually revert.\n\nContinue?`,
      )
    ) {
      return;
    }
    setBusy(row.id);
    try {
      const res = await csrfFetch(`/api/admin/backups/${row.id}/restore`, {
        method: "POST",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Restore failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(
        `Restored ${row.filename}. ${j.preRestoreTrashed?.length ?? 0} path(s) trashed. Start the server from the Server Controls.`,
      );
      refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="Backups"
      sub={data ? `${data.total} SNAPSHOTS` : undefined}
      right={
        <div className="flex items-center gap-2">
          <LiveDot variant={loading ? "warn" : "live"} label={loading ? "LOADING" : "READY"} />
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
          <strong className="text-pz-text">How it works.</strong> A backup is a{" "}
          <code className="pz-mono">.tar.gz</code> of{" "}
          <code className="pz-mono">Saves/Multiplayer/&lt;prefix&gt;</code>, the INI,
          the sandbox Lua, and the user DB. Stored under{" "}
          <code className="pz-mono">{data?.backupRoot ?? "$PZ_BACKUP_ROOT"}</code>.
          MANUAL backups are kept forever; AUTO backups are pruned to the newest 14.
          Restore requires the PZ container to be <strong>stopped</strong> (OWNER only).
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap p-3 bg-pz-bg-1 border border-pz-border-lo">
            <label className="pz-label w-[80px]">NOTES</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="optional, e.g. 'before raiding event'"
              maxLength={500}
              className="flex-1 min-w-[260px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
            />
            <Button size="sm" onClick={create} disabled={busy === "__create__"}>
              {busy === "__create__" ? "Backing up…" : "CREATE BACKUP"}
            </Button>
          </div>
        )}
      </div>

      {!data && <div className="p-6 text-center text-pz-muted text-xs">Loading…</div>}
      {data && data.rows.length === 0 && (
        <div className="p-6 text-center text-pz-muted text-xs">
          No backups yet. Click CREATE BACKUP above.
        </div>
      )}
      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="pz-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Kind</th>
                <th>Size</th>
                <th>Mods</th>
                <th>Created</th>
                <th>Notes</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((b) => (
                <tr key={b.id} className={!b.exists ? "opacity-40" : ""}>
                  <td>
                    <div className="pz-mono text-[11px] text-pz-text">{b.filename}</div>
                    {!b.exists && (
                      <span className="pz-mono text-[10px] text-pz-danger">
                        missing on disk
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={badgeForKind(b.kind)}>{b.kind}</span>
                  </td>
                  <td className="pz-mono text-[11px] text-pz-text-dim">
                    {formatBytes(b.sizeBytes)}
                  </td>
                  <td className="pz-mono text-[11px] text-pz-muted">
                    {b.modCount ?? "—"}
                  </td>
                  <td className="pz-mono text-[11px] text-pz-muted">
                    {relTime(b.createdAt)}
                  </td>
                  <td className="text-[11px] text-pz-text-dim max-w-[260px]">
                    {b.notes ? (
                      <span title={b.notes} className="line-clamp-2">
                        {b.notes}
                      </span>
                    ) : (
                      <span className="text-pz-muted">—</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="text-right whitespace-nowrap">
                      {b.exists && (
                        <a
                          href={`/api/admin/backups/${b.id}/download`}
                          className="inline-block px-2 py-1 text-[11px] pz-mono text-pz-primary hover:opacity-75 underline"
                        >
                          download
                        </a>
                      )}
                      {isOwner && b.exists && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => restore(b)}
                          disabled={busy === b.id}
                        >
                          {busy === b.id ? "..." : "Restore"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(b)}
                        disabled={busy === b.id}
                      >
                        Delete
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.orphans.length > 0 && (
        <div className="p-3 border-t border-pz-border-lo">
          <div className="text-[12px] text-pz-amber mb-1">
            ⚠ Orphaned tarballs ({data.orphans.length})
          </div>
          <div className="pz-mono text-[11px] text-pz-muted">
            Files in the backup dir without a matching DB row. Safe to leave
            alone — they are not shown in the restore list. Remove manually if
            disk space is tight.
          </div>
          <ul className="pz-mono text-[11px] text-pz-text-dim mt-2">
            {data.orphans.slice(0, 10).map((o) => (
              <li key={o.filename}>
                {o.filename} — {formatBytes(o.sizeBytes)}
              </li>
            ))}
            {data.orphans.length > 10 && (
              <li>…+{data.orphans.length - 10} more</li>
            )}
          </ul>
        </div>
      )}
    </Panel>
  );
}
