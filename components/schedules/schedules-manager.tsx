"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/pz/panel";
import { LiveDot } from "@/components/pz/live-dot";
import { Button } from "@/components/ui/button";
import { csrfFetch } from "@/lib/csrf/fetch";
import type { Role } from "@/lib/auth/role";

type ScheduleKind = "announce" | "restart" | "restart-warn" | "auto-backup";

interface ScheduleRow {
  id: string;
  name: string;
  cronExpr: string;
  kind: ScheduleKind;
  payload: Record<string, unknown> | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  cronValid: boolean;
  cronError: string | null;
  cronDescription: string;
}

interface ApiResponse {
  ok: true;
  schedules: ScheduleRow[];
  availableKinds: ScheduleKind[];
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const suffix = ms < 0 ? "ago" : "from now";
  if (abs < 60_000) return `${Math.floor(abs / 1000)}s ${suffix}`;
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}m ${suffix}`;
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}h ${suffix}`;
  return `${Math.floor(abs / 86_400_000)}d ${suffix}`;
}

const KIND_HINTS: Record<ScheduleKind, string> = {
  announce: 'payload: { "message": "Good evening survivors!" }',
  restart: 'payload: { "announceBefore": true } — restart now, with brief warning.',
  "restart-warn":
    'payload: { "warnMinutes": 10, "breakpoints": [5, 1], "reason": "nightly reboot" }',
  "auto-backup": 'payload: { "notes": "daily 04:00" }',
};

const KIND_DEFAULT_PAYLOAD: Record<ScheduleKind, Record<string, unknown>> = {
  announce: { message: "" },
  restart: { announceBefore: true },
  "restart-warn": { warnMinutes: 10, breakpoints: [5, 1], reason: "scheduled restart" },
  "auto-backup": { notes: "" },
};

export function SchedulesManager({ role }: { role: Role }) {
  const canEdit = role === "ADMIN" || role === "OWNER";
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Add form state
  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("0 4 * * *");
  const [kind, setKind] = useState<ScheduleKind>("restart-warn");
  const [payloadJson, setPayloadJson] = useState(
    JSON.stringify(KIND_DEFAULT_PAYLOAD["restart-warn"], null, 2),
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/schedules", { cache: "no-store" });
      if (res.ok) {
        setData((await res.json()) as ApiResponse);
      } else {
        toast.error(`Schedule list fetch failed: ${res.status}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function onKindChange(k: ScheduleKind) {
    setKind(k);
    setPayloadJson(JSON.stringify(KIND_DEFAULT_PAYLOAD[k], null, 2));
  }

  async function create(ev: React.FormEvent) {
    ev.preventDefault();
    if (!name.trim() || !cronExpr.trim()) return;
    let parsedPayload: Record<string, unknown> = {};
    try {
      parsedPayload = payloadJson.trim() ? JSON.parse(payloadJson) : {};
    } catch (e) {
      toast.error(`Invalid JSON payload: ${String(e)}`);
      return;
    }
    setBusy("__create__");
    try {
      const res = await csrfFetch("/api/admin/schedules", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          cronExpr: cronExpr.trim(),
          kind,
          payload: parsedPayload,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Create failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(`Schedule "${name}" created.`);
      setName("");
      setCronExpr("0 4 * * *");
      onKindChange("restart-warn");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(row: ScheduleRow) {
    setBusy(row.id);
    try {
      const res = await csrfFetch(`/api/admin/schedules/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Toggle failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: ScheduleRow) {
    if (!confirm(`Delete schedule "${row.name}"?`)) return;
    setBusy(row.id);
    try {
      const res = await csrfFetch(`/api/admin/schedules/${row.id}`, {
        method: "DELETE",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Delete failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(`Deleted "${row.name}"`);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function fire(row: ScheduleRow) {
    if (
      !confirm(
        `Fire "${row.name}" (${row.kind}) right now?\n\nThis runs the action as if the cron had matched this minute.`,
      )
    ) {
      return;
    }
    setBusy(row.id);
    try {
      const res = await csrfFetch(`/api/admin/schedules/${row.id}/fire`, {
        method: "POST",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Fire failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(`Fired: ${j.detail ?? "ok"}`);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  const rows = useMemo(() => data?.schedules ?? [], [data]);

  return (
    <Panel
      title="Schedules"
      sub={data ? `${data.schedules.filter((s) => s.enabled).length}/${data.schedules.length} ACTIVE` : undefined}
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
          <strong className="text-pz-text">How it works.</strong> Each row is a cron
          expression (<code className="pz-mono">min hr dom mon dow</code>, UTC) that
          fires one of four actions. The runner lives in the pz-crcon process and
          ticks every minute; missed fires during restarts are not caught up.
        </div>

        {canEdit && (
          <form
            onSubmit={create}
            className="flex flex-col gap-2 p-3 bg-pz-bg-1 border border-pz-border-lo"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <label className="pz-label w-[90px]">NAME</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. nightly-restart"
                className="flex-1 min-w-[200px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="pz-label w-[90px]">CRON</label>
              <input
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 4 * * *"
                className="flex-1 min-w-[200px] max-w-[300px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
              />
              <span className="pz-mono text-[10.5px] text-pz-muted">
                UTC · `0 4 * * *` = 04:00 every day
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="pz-label w-[90px]">KIND</label>
              <select
                value={kind}
                onChange={(e) => onKindChange(e.target.value as ScheduleKind)}
                className="bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text focus:outline-none focus:border-pz-border-hi"
              >
                <option value="restart-warn">restart-warn</option>
                <option value="restart">restart</option>
                <option value="announce">announce</option>
                <option value="auto-backup">auto-backup</option>
              </select>
              <span className="pz-mono text-[10.5px] text-pz-muted flex-1 min-w-[240px]">
                {KIND_HINTS[kind]}
              </span>
            </div>
            <div className="flex items-start gap-2 flex-wrap">
              <label className="pz-label w-[90px] pt-1">PAYLOAD</label>
              <textarea
                value={payloadJson}
                onChange={(e) => setPayloadJson(e.target.value)}
                rows={5}
                className="flex-1 min-w-[320px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={!name.trim() || !cronExpr.trim() || busy === "__create__"}
              >
                {busy === "__create__" ? "..." : "CREATE SCHEDULE"}
              </Button>
            </div>
          </form>
        )}
      </div>

      {!data && <div className="p-6 text-center text-pz-muted text-xs">Loading…</div>}
      {data && rows.length === 0 && (
        <div className="p-6 text-center text-pz-muted text-xs">
          No schedules yet. {canEdit ? "Create one above." : "Ask an admin to add one."}
        </div>
      )}
      {data && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="pz-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Cron</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Last run</th>
                <th>Next run</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={!s.enabled ? "opacity-55" : ""}>
                  <td>
                    <div className="font-medium text-pz-text">{s.name}</div>
                    {!s.cronValid && (
                      <div className="pz-mono text-[10px] text-pz-danger">
                        cron invalid: {s.cronError}
                      </div>
                    )}
                  </td>
                  <td className="pz-mono text-[11px] text-pz-text-dim">
                    <div>{s.cronExpr}</div>
                    <div className="pz-mono text-[9.5px] text-pz-muted">{s.cronDescription}</div>
                  </td>
                  <td>
                    <span className="pz-badge">{s.kind}</span>
                  </td>
                  <td>
                    {s.enabled ? (
                      <span className="pz-badge green">● ENABLED</span>
                    ) : (
                      <span className="pz-badge">DISABLED</span>
                    )}
                  </td>
                  <td className="pz-mono text-[11px] text-pz-muted">{relTime(s.lastRunAt)}</td>
                  <td className="pz-mono text-[11px] text-pz-muted">{relTime(s.nextRunAt)}</td>
                  {canEdit && (
                    <td className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleEnabled(s)}
                        disabled={busy === s.id}
                      >
                        {busy === s.id ? "..." : s.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => fire(s)}
                        disabled={busy === s.id}
                      >
                        Fire now
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(s)}
                        disabled={busy === s.id}
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
    </Panel>
  );
}
