"use client";

/**
 * Editable sandbox vars tab.
 *
 * Mirrors the ini tab: fetch on mount, render typed controls grouped by
 * `descriptor.section`, OWNER-only Save that posts through `csrfFetch`
 * and opens the diff + restart-prompt flow. Every sandbox key is
 * restart-gated (per SANDBOX_DESCRIPTORS), so the restart prompt is
 * always shown after a successful save.
 */

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/pz/panel";
import { Button } from "@/components/ui/button";
import {
  describeSandbox,
  SANDBOX_DESCRIPTORS,
  type SandboxDescriptor,
} from "@/lib/pz/sandbox-descriptors";
import type { Role } from "@/lib/auth/role";
import { atLeast } from "@/lib/auth/role";
import { csrfFetch } from "@/lib/csrf/fetch";
import { SandboxVarControl } from "./sandbox-var-control";
import { DiffModal, type DiffEntry } from "./diff-modal";
import { RestartPromptModal } from "./restart-prompt-modal";
import { useConfigBuffer, type ConfigValue } from "./use-config-buffer";

interface SandboxEntry {
  key: string;
  value: number | string | boolean;
  kind: "number" | "string" | "boolean" | "raw";
}

interface SandboxSection {
  name: string;
  entries: SandboxEntry[];
}

interface GetResponse {
  ok: boolean;
  path?: string;
  prefix?: string;
  mtimeMs?: number;
  sections?: SandboxSection[];
  error?: string;
}

interface Props {
  role: Role;
}

// Build the descriptor-path for a `{section, key}` pair the same way
// `parseSandboxLua` produces flat keys.
function flatPathFor(section: string, key: string): string {
  if (section === "_root") return key;
  return `${section}.${key}`;
}

export function SandboxTab({ role }: Props) {
  const canEdit = atLeast(role, "OWNER");
  const buffer = useConfigBuffer();
  const [meta, setMeta] = useState<{ path: string; prefix: string } | null>(
    null,
  );
  const [sections, setSections] = useState<SandboxSection[] | null>(null);
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
      const res = await fetch("/api/admin/config/sandbox", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setLoadError(`sandbox fetch failed (${res.status})`);
        return;
      }
      const j = (await res.json()) as GetResponse;
      if (!j.ok || !j.sections || j.mtimeMs === undefined) {
        setLoadError(j.error ?? "sandbox fetch returned not-ok");
        return;
      }
      setMeta({ path: j.path ?? "", prefix: j.prefix ?? "" });
      setSections(j.sections);
      const flat: Record<string, ConfigValue> = {};
      for (const s of j.sections) {
        for (const e of s.entries) {
          flat[flatPathFor(s.name, e.key)] = e.value;
        }
      }
      buffer.replaceSnapshot({ serverValues: flat, mtimeMs: j.mtimeMs });
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

  const visibleSections = useMemo(() => {
    if (!sections) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((s) => ({
        ...s,
        entries: s.entries.filter(
          (e) =>
            e.key.toLowerCase().includes(q) ||
            String(
              buffer.getValue(flatPathFor(s.name, e.key)) ?? e.value,
            )
              .toLowerCase()
              .includes(q) ||
            s.name.toLowerCase().includes(q),
        ),
      }))
      .filter((s) => s.entries.length > 0);
  }, [sections, filter, buffer]);

  async function onSave() {
    if (!canEdit || buffer.mtimeMs === null || !buffer.dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const patch = buffer.buildPatch();
      // Baseline values for the server's three-way merge; see
      // lib/pz/writer.ts for how `priorValues` is consumed.
      const priorValues: Record<string, ConfigValue> = {};
      for (const k of Object.keys(patch)) {
        const v = buffer.serverValues[k];
        if (v !== undefined) priorValues[k] = v;
      }
      const res = await csrfFetch("/api/admin/config/sandbox", {
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
        if (res.status === 409) await reload();
        return;
      }
      setDiff(j.diff ?? []);
      setDiffOpen(true);
      await reload();
      if (j.requiresRestart) {
        setRestartOpen(true);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !sections) {
    return (
      <Panel title="Sandbox Vars">
        <p className="text-pz-muted text-xs">Loading sandbox vars…</p>
      </Panel>
    );
  }
  if (loadError) {
    return (
      <Panel title="Sandbox Vars">
        <p className="text-pz-danger text-sm">{loadError}</p>
      </Panel>
    );
  }

  const totalKeys =
    sections?.reduce((n, s) => n + s.entries.length, 0) ?? 0;

  return (
    <>
      <Panel
        title="Sandbox Vars"
        sub={`${meta?.prefix ?? ""}_SandboxVars.lua · ${totalKeys} KEYS`}
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
            placeholder="search section / key / value..."
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
          {visibleSections.length === 0 && (
            <div className="p-4 text-pz-muted text-xs text-center">
              No sandbox vars match.
            </div>
          )}
          {visibleSections.map((s) => (
            <section key={s.name} className="border-b border-pz-border-lo">
              <div className="px-3 py-1.5 bg-pz-bg-1">
                <span className="pz-label">
                  {s.name === "_root" ? "Root" : s.name}
                </span>
                <span className="pz-mono text-[10.5px] text-pz-muted ml-2">
                  {s.entries.length}
                </span>
              </div>
              <table className="pz-table text-xs">
                <thead>
                  <tr>
                    <th className="w-[280px]">Key</th>
                    <th>Value</th>
                    <th className="w-[72px]">Default</th>
                  </tr>
                </thead>
                <tbody>
                  {s.entries.map((e) => {
                    const path = flatPathFor(s.name, e.key);
                    const descriptor: SandboxDescriptor | undefined =
                      describeSandbox(path);
                    const current = buffer.getValue(path) ?? e.value;
                    const dirty = buffer.dirtyKeys.includes(path);
                    return (
                      <tr
                        key={path}
                        className={dirty ? "bg-pz-accent/5" : undefined}
                      >
                        <td className="pz-mono text-pz-text align-top py-2">
                          <div>{e.key}</div>
                          {descriptor && (
                            <div className="text-[10.5px] text-pz-muted font-sans mt-0.5">
                              {descriptor.help}
                            </div>
                          )}
                        </td>
                        <td className="pz-mono align-top py-2">
                          {descriptor ? (
                            <SandboxVarControl
                              descriptor={descriptor}
                              value={current as ConfigValue}
                              disabled={!canEdit}
                              onChange={(nv) => buffer.setValue(path, nv)}
                            />
                          ) : (
                            <span className="text-pz-muted">
                              (no descriptor: {String(current)})
                            </span>
                          )}
                        </td>
                        <td className="pz-mono text-[10.5px] text-pz-muted align-top py-2">
                          {descriptor ? String(descriptor.default) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </Panel>

      <DiffModal
        open={diffOpen}
        diff={diff}
        title="Sandbox vars saved"
        description="Backup written to .backups/. Changes are on disk but require a restart to apply."
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
        reason="All sandbox variables require a PZ server restart to take effect."
      />
    </>
  );
}

// Ensure tree-shaking doesn't drop the constant that only gets imported
// for its side-effect of ensuring descriptors are present at build time.
void SANDBOX_DESCRIPTORS.length;
