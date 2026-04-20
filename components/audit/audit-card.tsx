"use client";

/**
 * Compact audit feed for the /admin dashboard.
 *
 * Pulls from GET /api/admin/audit and renders a relative-time list of
 * recent events. "Load more" paginates via `nextCursor`. Uses MODERATOR+
 * data — the endpoint gates the read.
 */

import { useEffect, useState } from "react";
import { Panel } from "@/components/pz/panel";
import { Button } from "@/components/ui/button";

interface AuditRow {
  id: string;
  userId: string;
  kind: string;
  detail: unknown;
  createdAt: string;
}

interface Response {
  ok: boolean;
  rows: AuditRow[];
  nextCursor: string | null;
}

const KIND_LABEL: Record<string, string> = {
  CONFIG_WRITE: "config write",
  LIFECYCLE_START: "server start",
  LIFECYCLE_STOP: "server stop",
  LIFECYCLE_RESTART: "server restart",
  LIFECYCLE_FORCE_STOP: "force stop",
  LIFECYCLE_ABORT: "lifecycle abort",
};

function summariseDetail(kind: string, detail: unknown): string {
  if (detail && typeof detail === "object") {
    const d = detail as { file?: string; diff?: Array<{ path: string }> };
    if (kind === "CONFIG_WRITE") {
      const paths =
        d.diff?.map((x) => x.path).slice(0, 3).join(", ") ?? "";
      const more =
        d.diff && d.diff.length > 3 ? ` +${d.diff.length - 3} more` : "";
      return `${d.file ?? "?"} · ${paths}${more}`;
    }
  }
  return "";
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const delta = Math.round((Date.now() - then) / 1000);
  if (delta < 5) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function AuditCard() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(cursor?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(
        "/api/admin/audit",
        typeof window !== "undefined"
          ? window.location.origin
          : "http://localhost",
      );
      url.searchParams.set("limit", "25");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url.toString(), {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError(`audit fetch failed (${res.status})`);
        return;
      }
      const j = (await res.json()) as Response;
      if (!j.ok) {
        setError("audit fetch returned not-ok");
        return;
      }
      setRows((prev) => (cursor ? [...prev, ...j.rows] : j.rows));
      setNextCursor(j.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Panel
      title="Audit log"
      sub={`${rows.length} RECENT`}
      dense
      bodyClassName="p-0"
    >
      {error && (
        <div className="p-2 text-pz-danger text-xs border-b border-pz-border-lo">
          {error}
        </div>
      )}
      <ul className="max-h-[420px] overflow-y-auto divide-y divide-pz-border-lo">
        {rows.length === 0 && !loading && (
          <li className="p-3 text-pz-muted text-xs text-center">
            No audit events yet.
          </li>
        )}
        {rows.map((r) => (
          <li key={r.id} className="px-3 py-2 flex items-start gap-3">
            <span className="pz-mono text-[10.5px] text-pz-muted w-20 shrink-0">
              {formatRelative(r.createdAt)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="pz-label text-[9.5px]">
                  {KIND_LABEL[r.kind] ?? r.kind}
                </span>
                <span className="pz-mono text-[10.5px] text-pz-text-faint">
                  {r.userId.slice(0, 8)}
                </span>
              </div>
              <div className="pz-mono text-[10.5px] text-pz-text-dim mt-0.5 break-all">
                {summariseDetail(r.kind, r.detail)}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="p-2 border-t border-pz-border-lo flex justify-between items-center">
        <span className="pz-mono text-[10.5px] text-pz-muted">
          {loading ? "loading…" : nextCursor ? "" : "end"}
        </span>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!nextCursor || loading}
          onClick={() => load(nextCursor)}
        >
          Load more
        </Button>
      </div>
    </Panel>
  );
}
