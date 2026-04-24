"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/pz/panel";
import { Button } from "@/components/ui/button";
import { csrfFetch } from "@/lib/csrf/fetch";
import type { Role } from "@/lib/auth/role";

interface CatalogEntry {
  key: string;
  label: string;
  defaultEnabled: boolean;
}

interface DiscordSettingsResponse {
  ok: true;
  webhookUrl: string | null;
  webhookMasked: boolean;
  username: string | null;
  avatarUrl: string | null;
  rules: Record<string, boolean>;
  catalog: CatalogEntry[];
  defaults: Record<string, boolean>;
}

export function DiscordTab({ role }: { role: Role }) {
  const isOwner = role === "OWNER";
  const [data, setData] = useState<DiscordSettingsResponse | null>(null);
  const [draftWebhook, setDraftWebhook] = useState("");
  const [draftUsername, setDraftUsername] = useState("");
  const [draftRules, setDraftRules] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [testNote, setTestNote] = useState("Hello from pz-crcon");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/settings/discord", { cache: "no-store" });
    if (res.ok) {
      const j = (await res.json()) as DiscordSettingsResponse;
      setData(j);
      setDraftWebhook(j.webhookMasked ? "" : j.webhookUrl ?? "");
      setDraftUsername(j.username ?? "");
      setDraftRules({ ...j.rules });
    } else {
      toast.error(`Discord settings fetch failed: ${res.status}`);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save() {
    setBusy("__save__");
    try {
      const body: Record<string, unknown> = { rules: draftRules };
      if (isOwner) {
        body.webhookUrl = draftWebhook.trim() || null;
        body.username = draftUsername.trim() || null;
      }
      const res = await csrfFetch("/api/admin/settings/discord", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Save failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      toast.success("Discord settings saved");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("__test__");
    try {
      const res = await csrfFetch("/api/admin/settings/discord/test", {
        method: "POST",
        body: JSON.stringify({ note: testNote }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.sent) {
        toast.error(`Test send failed: ${j.reason ?? j.detail ?? res.status}`);
        return;
      }
      toast.success("Test embed sent — check your Discord channel");
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return <div className="p-6 text-center text-pz-muted text-xs">Loading…</div>;
  }

  return (
    <Panel
      title="Discord notifications"
      sub={
        data.webhookUrl
          ? data.webhookMasked
            ? "WEBHOOK CONFIGURED (MASKED)"
            : "WEBHOOK CONFIGURED"
          : "NO WEBHOOK"
      }
      dense
      bodyClassName="p-0"
    >
      <div className="p-3 border-b border-pz-border-lo flex flex-col gap-3">
        <div className="bg-pz-bg-1 border border-pz-border-lo px-3 py-2 text-[12px] text-pz-text-dim">
          <strong className="text-pz-text">How it works.</strong> Every panel
          action (kick, ban, backup, mod changes) and every Lua-mod event
          (death, join, leave, heli) can fan out to a Discord channel via an
          incoming webhook. OWNER sets the URL; ADMIN+ can toggle individual
          rules. Changes persist in the <code className="pz-mono">Setting</code>{" "}
          table and take effect immediately — no redeploy.
        </div>

        {isOwner && (
          <div className="flex flex-col gap-2 p-3 bg-pz-bg-1 border border-pz-border-lo">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="pz-label w-[110px]">WEBHOOK URL</label>
              <input
                value={draftWebhook}
                onChange={(e) => setDraftWebhook(e.target.value)}
                placeholder={
                  data.webhookUrl && data.webhookMasked
                    ? `${data.webhookUrl} (enter new to replace)`
                    : "https://discord.com/api/webhooks/…/…"
                }
                className="flex-1 min-w-[300px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="pz-label w-[110px]">USERNAME</label>
              <input
                value={draftUsername}
                onChange={(e) => setDraftUsername(e.target.value)}
                placeholder="pz-crcon (optional override)"
                maxLength={80}
                className="w-[260px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 p-3 bg-pz-bg-1 border border-pz-border-lo">
          <div className="pz-label">PER-EVENT RULES</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            {data.catalog.map((e) => (
              <label
                key={e.key}
                className="flex items-center gap-2 pz-mono text-[11px] text-pz-text-dim cursor-pointer hover:text-pz-text"
              >
                <input
                  type="checkbox"
                  checked={draftRules[e.key] ?? e.defaultEnabled}
                  onChange={(ev) =>
                    setDraftRules((prev) => ({
                      ...prev,
                      [e.key]: ev.target.checked,
                    }))
                  }
                  className="accent-pz-primary"
                />
                <span>
                  <span className="text-pz-text">{e.label}</span>
                  <span className="ml-1 text-pz-muted">
                    ({e.key})
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={save} disabled={busy === "__save__"}>
            {busy === "__save__" ? "Saving…" : "Save"}
          </Button>
          {isOwner && data.webhookUrl && (
            <>
              <input
                value={testNote}
                onChange={(e) => setTestNote(e.target.value)}
                placeholder="test embed description…"
                className="flex-1 max-w-[400px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text focus:outline-none focus:border-pz-border-hi"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={sendTest}
                disabled={busy === "__test__"}
              >
                {busy === "__test__" ? "..." : "Send test embed"}
              </Button>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
