"use client";

/**
 * Editable server.ini tab.
 *
 * - Fetches `/api/admin/config/ini` on mount (server-side redaction is in
 *   effect for non-OWNERs).
 * - Renders typed controls grouped by descriptor group.
 * - OWNERs see a Save button; save calls `csrfFetch(PUT /api/.../ini, …)`
 *   with an mtime gate and opens the diff modal on success. If any
 *   changed key is restart-gated, chains into the restart prompt modal.
 * - Drafts for redacted secret keys stay `__REDACTED__` until the
 *   reveal flow replaces them; sending `__REDACTED__` back to the server
 *   would clobber the real password, so we drop any still-redacted
 *   secrets from the patch.
 */

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/pz/panel";
import { Button } from "@/components/ui/button";
import {
  describeIni,
  INI_DESCRIPTORS,
  INI_GROUP_LABELS,
  type IniDescriptor,
  type IniGroup,
} from "@/lib/pz/ini-descriptors";
import { csrfFetch } from "@/lib/csrf/fetch";
import type { Role } from "@/lib/auth/role";
import { atLeast } from "@/lib/auth/role";
import { EditableIniRow } from "./editable-ini-row";
import { DiffModal, type DiffEntry } from "./diff-modal";
import { RestartPromptModal } from "./restart-prompt-modal";
import { useConfigBuffer, type ConfigValue } from "./use-config-buffer";

interface Entry {
  key: string;
  value: string;
  redacted?: boolean;
}

interface GetResponse {
  ok: boolean;
  path?: string;
  prefix?: string;
  mtimeMs?: number;
  entries?: Entry[];
  error?: string;
}

interface Props {
  role: Role;
}

const GROUP_ORDER: IniGroup[] = [
  "general",
  "capacity",
  "network",
  "gameplay",
  "pvp",
  "safehouse",
  "whitelist",
  "anticheat",
  "mods",
  "voip",
  "logging",
  "discord",
  "backup",
  "chat",
  "faction",
  "other",
];

const REDACTED = "__REDACTED__";

function coerceFromIni(
  raw: string,
  d: IniDescriptor,
): ConfigValue {
  switch (d.type) {
    case "int": {
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : 0;
    }
    case "float": {
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : 0;
    }
    case "bool":
      return raw;
    default:
      return raw;
  }
}

export function ServerIniTab({ role }: Props) {
  const canEdit = atLeast(role, "OWNER");
  const buffer = useConfigBuffer();
  const [meta, setMeta] = useState<{ path: string; prefix: string } | null>(
    null,
  );
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diff, setDiff] = useState<DiffEntry[]>([]);
  const [restartOpen, setRestartOpen] = useState(false);

  const reload = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/config/ini", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setLoadError(`ini fetch failed (${res.status})`);
        return;
      }
      const j = (await res.json()) as GetResponse;
      if (!j.ok || !j.entries || j.mtimeMs === undefined) {
        setLoadError(j.error ?? "ini fetch returned not-ok");
        return;
      }
      setMeta({ path: j.path ?? "", prefix: j.prefix ?? "" });
      setEntries(j.entries);
      const serverValues: Record<string, ConfigValue> = {};
      for (const e of j.entries) {
        const d = INI_DESCRIPTORS[e.key];
        serverValues[e.key] = d ? coerceFromIni(e.value, d) : e.value;
      }
      buffer.replaceSnapshot({ serverValues, mtimeMs: j.mtimeMs });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    if (!entries) return {} as Record<IniGroup, Entry[]>;
    const q = filter.trim().toLowerCase();
    const visible = q
      ? entries.filter(
          (e) =>
            e.key.toLowerCase().includes(q) ||
            String(buffer.getValue(e.key) ?? e.value)
              .toLowerCase()
              .includes(q),
        )
      : entries;
    const out = {} as Record<IniGroup, Entry[]>;
    for (const e of visible) {
      const { group } = describeIni(e.key);
      (out[group] ??= []).push(e);
    }
    return out;
  }, [entries, filter, buffer]);

  async function onSave() {
    if (!canEdit || buffer.mtimeMs === null || !buffer.dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const rawPatch = buffer.buildPatch();
      // Drop any still-redacted secret keys — sending `__REDACTED__`
      // would overwrite the live password with the literal string.
      const patch: Record<string, ConfigValue> = {};
      for (const [k, v] of Object.entries(rawPatch)) {
        if (INI_DESCRIPTORS[k]?.secret && v === REDACTED) continue;
        patch[k] = v;
      }
      if (Object.keys(patch).length === 0) {
        setSaveError("nothing to save (redacted secrets only)");
        return;
      }
      // Baseline for the server's three-way merge: values the client
      // saw at load time. Lets the writer tolerate PZ rewriting the
      // ini on disk while we were editing unrelated keys.
      const priorValues: Record<string, ConfigValue> = {};
      for (const k of Object.keys(patch)) {
        const v = buffer.serverValues[k];
        if (v !== undefined) priorValues[k] = v;
      }
      const res = await csrfFetch("/api/admin/config/ini", {
        method: "PUT",
        body: JSON.stringify({
          clientMtimeMs: buffer.mtimeMs,
          patch,
          priorValues,
        }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        code?: string;
        detail?: string;
        diff?: DiffEntry[];
        newMtimeMs?: number;
        requiresRestart?: boolean;
        conflicts?: Array<{
          path: string;
          prior: unknown;
          patch: unknown;
          disk: unknown;
        }>;
      };
      if (!res.ok || !j.ok) {
        if (res.status === 409 && j.code === "mtime-race" && j.conflicts?.length) {
          const lines = j.conflicts
            .map(
              (c) =>
                `  • ${c.path}: disk=${String(c.disk)} (you had ${String(c.prior)}, wanted ${String(c.patch)})`,
            )
            .join("\n");
          setSaveError(
            `mtime-race: ${j.conflicts.length} key(s) changed on disk since you loaded:\n${lines}\nRefresh and re-apply.`,
          );
        } else {
          setSaveError(
            `${j.code ?? res.status}${j.detail ? `: ${j.detail}` : ""}`,
          );
        }
        if (res.status === 409) {
          // refresh from server so user sees current state; drafts
          // stay in memory because the user's buffer is separate
          // (replaceSnapshot does wipe them — this is a known
          // tradeoff; the error message above tells them what to
          // re-apply).
          await reload();
        }
        return;
      }
      setDiff(j.diff ?? []);
      setDiffOpen(true);
      if (j.newMtimeMs !== undefined) {
        await reload();
      }
      if (j.requiresRestart) {
        setRestartOpen(true);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !entries) {
    return (
      <Panel title="Server INI">
        <p className="text-pz-muted text-xs">Loading server.ini…</p>
      </Panel>
    );
  }
  if (loadError) {
    return (
      <Panel title="Server INI">
        <p className="text-pz-danger text-sm">{loadError}</p>
      </Panel>
    );
  }

  const totalKeys = entries?.length ?? 0;

  return (
    <>
      <Panel
        title="Server INI"
        sub={`${meta?.prefix ?? ""}.ini · ${totalKeys} KEYS`}
        dense
        bodyClassName="p-0"
        right={
          canEdit && (
            <div className="flex items-center gap-2">
              {buffer.dirty && (
                <span className="pz-mono text-[10.5px] text-pz-accent">
                  {buffer.dirtyKeys.length} CHANGED
                </span>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={buffer.reset}
                disabled={!buffer.dirty || saving}
              >
                Discard
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSave}
                disabled={!buffer.dirty || saving}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          )
        }
      >
        <div className="p-2 border-b border-pz-border-lo flex items-center gap-2 flex-wrap">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 min-w-[200px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
            placeholder="search key or value..."
          />
          <span className="pz-mono text-[10.5px] text-pz-muted">
            {meta?.path ?? ""}
          </span>
        </div>
        {saveError && (
          <div className="p-2 bg-pz-danger/20 text-pz-danger text-xs border-b border-pz-border-lo pz-mono whitespace-pre-wrap">
            save failed: {saveError}
          </div>
        )}
        <div className="max-h-[65vh] overflow-y-auto">
          {GROUP_ORDER.map((g) => {
            const items = grouped[g] ?? [];
            if (items.length === 0) return null;
            return (
              <section key={g} className="border-b border-pz-border-lo">
                <div className="px-3 py-1.5 bg-pz-bg-1">
                  <span className="pz-label">{INI_GROUP_LABELS[g]}</span>
                </div>
                <table className="pz-table text-xs">
                  <thead>
                    <tr>
                      <th className="w-[280px]">Key</th>
                      <th>Value</th>
                      <th className="w-[72px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((e) => {
                      const d = describeIni(e.key);
                      const v = buffer.getValue(e.key);
                      const dirty = buffer.dirtyKeys.includes(e.key);
                      return (
                        <tr
                          key={e.key}
                          className={dirty ? "bg-pz-accent/5" : undefined}
                        >
                          <td className="pz-mono text-pz-text align-top py-2">
                            <div>{e.key}</div>
                            <div className="text-[10.5px] text-pz-muted font-sans mt-0.5">
                              {d.description}
                            </div>
                          </td>
                          <td className="pz-mono align-top py-2">
                            <EditableIniRow
                              keyName={e.key}
                              descriptor={d}
                              value={v ?? ""}
                              canRevealSecrets={canEdit}
                              disabled={!canEdit}
                              onChange={(nv) => buffer.setValue(e.key, nv)}
                            />
                          </td>
                          <td className="align-top py-2">
                            {d.requiresRestart && (
                              <span
                                className="pz-badge amber text-[9.5px]"
                                title="Changing this value requires restart"
                              >
                                RESTART
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      </Panel>

      <DiffModal
        open={diffOpen}
        diff={diff}
        title="Server INI saved"
        description="Backup written to .backups/. The changes are live on disk."
        onConfirm={() => setDiffOpen(false)}
        onCancel={() => setDiffOpen(false)}
      />

      <RestartPromptModal
        open={restartOpen}
        canRestart={true}
        onRestart={async () => {
          setRestartOpen(false);
          try {
            const res = await csrfFetch("/api/admin/server/restart", {
              method: "POST",
            });
            const j = (await res.json().catch(() => ({}))) as {
              code?: string;
            };
            const { toast } = await import("sonner");
            if (res.ok) toast.success("Restart started. Watch the phase badge.");
            else if (j.code === "lifecycle-busy")
              toast.error("Lifecycle busy — another operation is in progress.");
            else if (j.code === "proxy-unreachable")
              toast.error("Proxy unreachable — check docker-socket-proxy.");
            else toast.error(`Restart failed (${res.status})`);
          } catch (e) {
            const { toast } = await import("sonner");
            toast.error(`Restart failed: ${String(e)}`);
          }
        }}
        onLater={() => setRestartOpen(false)}
        reason="One or more INI keys you changed only take effect after the PZ server restarts."
      />
    </>
  );
}
