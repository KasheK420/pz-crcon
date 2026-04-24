"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/pz/panel";
import { Button } from "@/components/ui/button";
import { csrfFetch } from "@/lib/csrf/fetch";

interface UserRow {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
  role: "OWNER" | "ADMIN" | "MODERATOR" | "VIEWER";
  createdAt: string;
  lastLogin: string | null;
  inAllowlist: boolean;
  allowlistRank: "OWNER" | "ADMIN" | null;
}

interface ApiResponse {
  ok: true;
  users: UserRow[];
}

const ROLES: UserRow["role"][] = ["VIEWER", "MODERATOR", "ADMIN", "OWNER"];

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function UsersTab({ currentUserId }: { currentUserId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (res.ok) {
      setData((await res.json()) as ApiResponse);
    } else {
      toast.error(`User list fetch failed: ${res.status}`);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function updateRole(u: UserRow, nextRole: UserRow["role"]) {
    if (nextRole === u.role) return;
    setBusy(u.id);
    try {
      const res = await csrfFetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Role change failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(`${u.username}: ${u.role} → ${nextRole}`);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(u: UserRow) {
    if (!confirm(`Delete ${u.username} (${u.discordId})?\n\nIf their Discord ID is in DISCORD_ADMIN_IDS they'll be re-created on next login.`)) {
      return;
    }
    setBusy(u.id);
    try {
      const res = await csrfFetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Delete failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success(`Deleted ${u.username}`);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="Users"
      sub={data ? `${data.users.length} USERS` : undefined}
      dense
      bodyClassName="p-0"
    >
      <div className="p-3 border-b border-pz-border-lo">
        <div className="bg-pz-bg-1 border border-pz-border-lo px-3 py-2 text-[12px] text-pz-text-dim">
          <strong className="text-pz-text">Heads up.</strong> Removing a user
          here does <strong>not</strong> un-allowlist them. Admission is
          controlled by <code className="pz-mono">DISCORD_ADMIN_IDS</code> in
          the compose <code className="pz-mono">.env</code> — if their
          Discord ID is still listed, the next login re-creates the row at
          the default role (first ID = OWNER, others = ADMIN). Row with the
          <span className="pz-badge ml-1">● ALLOW</span> badge indicates a
          listed ID.
        </div>
      </div>

      {!data && <div className="p-6 text-center text-pz-muted text-xs">Loading…</div>}
      {data && data.users.length === 0 && (
        <div className="p-6 text-center text-pz-muted text-xs">No users yet.</div>
      )}
      {data && data.users.length > 0 && (
        <div className="overflow-x-auto">
          <table className="pz-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Discord ID</th>
                <th>Role</th>
                <th>Allowlist</th>
                <th>Created</th>
                <th>Last login</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id} className={isSelf ? "bg-pz-bg-1" : ""}>
                    <td className="flex items-center gap-2">
                      {u.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png?size=32`}
                          alt=""
                          width={24}
                          height={24}
                          className="rounded-sm border border-pz-border-lo"
                        />
                      ) : (
                        <div className="w-6 h-6 bg-pz-bg-0 border border-pz-border-lo" />
                      )}
                      <span className="text-pz-text">{u.username}</span>
                      {isSelf && (
                        <span className="pz-pill pz-mono" title="current session">
                          YOU
                        </span>
                      )}
                    </td>
                    <td className="pz-mono text-[11px] text-pz-text-dim">
                      {u.discordId}
                    </td>
                    <td>
                      <select
                        value={u.role}
                        onChange={(ev) => updateRole(u, ev.target.value as UserRow["role"])}
                        disabled={busy === u.id}
                        className="bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text focus:outline-none focus:border-pz-border-hi"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {u.inAllowlist ? (
                        <span className="pz-badge green">
                          ● ALLOW ({u.allowlistRank})
                        </span>
                      ) : (
                        <span className="pz-badge">not listed</span>
                      )}
                    </td>
                    <td className="pz-mono text-[11px] text-pz-muted">
                      {relTime(u.createdAt)}
                    </td>
                    <td className="pz-mono text-[11px] text-pz-muted">
                      {relTime(u.lastLogin)}
                    </td>
                    <td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(u)}
                        disabled={busy === u.id || isSelf}
                        title={isSelf ? "cannot delete self" : undefined}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
