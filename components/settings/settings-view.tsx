"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/pz/panel";
import { LiveDot } from "@/components/pz/live-dot";
import { Button } from "@/components/ui/button";
import { csrfFetch } from "@/lib/csrf/fetch";
import type { Role } from "@/lib/auth/role";

interface SettingEntry {
  key: string;
  label: string;
  value: string | null;
  group: "public" | "server" | "rcon" | "discord" | "webhook";
  secret?: boolean;
  description: string;
}

interface ApiResponse {
  ok: true;
  entries: SettingEntry[];
  note: string;
}

interface TokenRow {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

const GROUP_LABEL: Record<SettingEntry["group"], string> = {
  public: "Public site",
  server: "PZ server",
  rcon: "RCON",
  discord: "Discord OAuth",
  webhook: "Phase 4 webhook",
};

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function SettingsView({ role }: { role: Role }) {
  const isOwner = role === "OWNER";
  const [data, setData] = useState<ApiResponse | null>(null);
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenScopes, setNewTokenScopes] = useState("read:players,read:events");
  const [newTokenExpiry, setNewTokenExpiry] = useState("");
  const [justCreated, setJustCreated] = useState<{
    token: string;
    prefix: string;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/settings", { cache: "no-store" });
      if (res.ok) {
        setData((await res.json()) as ApiResponse);
      }
      if (isOwner) {
        const tr = await fetch("/api/admin/tokens", { cache: "no-store" });
        if (tr.ok) {
          const j = (await tr.json()) as { tokens: TokenRow[] };
          setTokens(j.tokens);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function createToken(ev: React.FormEvent) {
    ev.preventDefault();
    if (!newTokenName.trim()) return;
    const scopes = newTokenScopes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setBusy("__create__");
    try {
      const body: Record<string, unknown> = {
        name: newTokenName.trim(),
        scopes,
      };
      if (newTokenExpiry.trim() && /^\d+$/.test(newTokenExpiry.trim())) {
        body.expiresInDays = Number(newTokenExpiry.trim());
      }
      const res = await csrfFetch("/api/admin/tokens", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Create failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      setJustCreated({ token: j.token, prefix: j.row.prefix, name: j.row.name });
      setNewTokenName("");
      setNewTokenScopes("read:players,read:events");
      setNewTokenExpiry("");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function revoke(t: TokenRow) {
    if (!confirm(`Revoke "${t.name}" (prefix ${t.prefix})?`)) return;
    setBusy(t.id);
    try {
      const res = await csrfFetch(`/api/admin/tokens/${t.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Revoke failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(`Revoked ${t.name}`);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  const groups = data
    ? Array.from(new Set(data.entries.map((e) => e.group)))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Environment configuration"
        sub={data ? `${data.entries.length} KEYS` : undefined}
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
        <div className="bg-pz-bg-1 border-b border-pz-border-lo px-3 py-2 text-[12px] text-pz-text-dim">
          <strong className="text-pz-text">Read-only.</strong>{" "}
          {data?.note ?? "Settings come from env vars and require a redeploy to change."}
        </div>

        {!data && <div className="p-6 text-center text-pz-muted text-xs">Loading…</div>}

        {data &&
          groups.map((g) => (
            <div key={g} className="border-b border-pz-border-lo">
              <div className="px-3 py-1.5 bg-pz-bg-0 pz-display-h text-[11px] text-pz-muted">
                {GROUP_LABEL[g]}
              </div>
              <table className="pz-table">
                <tbody>
                  {data.entries
                    .filter((e) => e.group === g)
                    .map((e) => (
                      <tr key={e.key}>
                        <td className="pz-mono text-[11px] text-pz-text-dim w-[260px]">
                          {e.key}
                        </td>
                        <td>
                          <div className="text-[12px] text-pz-text">{e.label}</div>
                          <div className="pz-mono text-[10.5px] text-pz-muted">
                            {e.description}
                          </div>
                        </td>
                        <td className="pz-mono text-[11px] text-pz-text-dim max-w-[400px]">
                          {e.value === null ? (
                            <span className="text-pz-muted">(not set)</span>
                          ) : (
                            <span className={e.secret ? "text-pz-amber" : ""}>
                              {e.value}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
      </Panel>

      {isOwner && (
        <Panel
          title="API tokens"
          sub={tokens ? `${tokens.length} ACTIVE` : undefined}
          right={<LiveDot variant="live" label="OWNER ONLY" />}
          dense
          bodyClassName="p-0"
        >
          <div className="p-3 border-b border-pz-border-lo flex flex-col gap-3">
            <div className="bg-pz-bg-1 border border-pz-border-lo px-3 py-2 text-[12px] text-pz-text-dim">
              <strong className="text-pz-text">Bearer tokens.</strong> Used by the
              upcoming Phase 4 Lua companion mod (webhook) and any external tooling
              that wants to read the panel API. Tokens are stored hashed — the raw
              value is shown exactly once at creation time. Scopes are strings enforced
              at route level; start with <code className="pz-mono">read:players</code>,{" "}
              <code className="pz-mono">read:events</code>,{" "}
              <code className="pz-mono">write:events</code>.
            </div>

            {justCreated && (
              <div className="bg-pz-amber/15 border border-pz-amber px-3 py-2 flex flex-col gap-2">
                <div className="pz-display-h text-pz-amber text-[12px]">
                  ⚠ Copy this token — it won&apos;t be shown again.
                </div>
                <code className="pz-mono text-[11px] text-pz-text break-all select-all">
                  {justCreated.token}
                </code>
                <div className="pz-mono text-[10.5px] text-pz-muted">
                  prefix={justCreated.prefix} · name={justCreated.name}
                </div>
                <button
                  type="button"
                  onClick={() => setJustCreated(null)}
                  className="pz-pill self-start cursor-pointer"
                >
                  I copied it, dismiss
                </button>
              </div>
            )}

            <form
              onSubmit={createToken}
              className="flex flex-col gap-2 p-3 bg-pz-bg-1 border border-pz-border-lo"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <label className="pz-label w-[90px]">NAME</label>
                <input
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  placeholder="e.g. lua-mod-prod"
                  className="flex-1 min-w-[200px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="pz-label w-[90px]">SCOPES</label>
                <input
                  value={newTokenScopes}
                  onChange={(e) => setNewTokenScopes(e.target.value)}
                  placeholder="comma-separated, e.g. read:players,write:events"
                  className="flex-1 min-w-[260px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="pz-label w-[90px]">EXPIRES</label>
                <input
                  value={newTokenExpiry}
                  onChange={(e) => setNewTokenExpiry(e.target.value)}
                  placeholder="days (blank = never)"
                  className="w-[180px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!newTokenName.trim() || busy === "__create__"}
                >
                  {busy === "__create__" ? "..." : "GENERATE TOKEN"}
                </Button>
              </div>
            </form>
          </div>

          {!tokens && <div className="p-6 text-center text-pz-muted text-xs">Loading…</div>}
          {tokens && tokens.length === 0 && (
            <div className="p-6 text-center text-pz-muted text-xs">
              No tokens yet. Generate one above.
            </div>
          )}
          {tokens && tokens.length > 0 && (
            <div className="overflow-x-auto">
              <table className="pz-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Prefix</th>
                    <th>Scopes</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th>Expires</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.id}>
                      <td className="text-pz-text font-medium">{t.name}</td>
                      <td className="pz-mono text-[11px] text-pz-text-dim">{t.prefix}…</td>
                      <td className="pz-mono text-[11px] text-pz-muted">
                        {t.scopes.length ? t.scopes.join(", ") : "—"}
                      </td>
                      <td className="pz-mono text-[11px] text-pz-muted">
                        {relTime(t.createdAt)}
                      </td>
                      <td className="pz-mono text-[11px] text-pz-muted">
                        {relTime(t.lastUsedAt)}
                      </td>
                      <td className="pz-mono text-[11px] text-pz-muted">
                        {t.expiresAt ? relTime(t.expiresAt) : "never"}
                      </td>
                      <td className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revoke(t)}
                          disabled={busy === t.id}
                        >
                          {busy === t.id ? "..." : "Revoke"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
