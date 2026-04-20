"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/pz/panel";

interface Entry {
  key: string;
  value: number | string | boolean;
  kind: "number" | "string" | "boolean" | "raw";
}

interface Section {
  name: string;
  entries: Entry[];
}

interface Props {
  ok: boolean;
  path: string;
  prefix: string;
  error?: string;
  sections?: Section[];
}

function formatValue(v: number | string | boolean, kind: Entry["kind"]) {
  if (kind === "boolean") return v ? "true" : "false";
  if (kind === "string") return `"${v}"`;
  return String(v);
}

function renderSectionLabel(name: string): string {
  return name === "_root" ? "Root" : name;
}

export function SandboxTab({ ok, path, prefix, error, sections }: Props) {
  const [filter, setFilter] = useState("");

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
            String(e.value).toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q),
        ),
      }))
      .filter((s) => s.entries.length > 0);
  }, [sections, filter]);

  if (!ok) {
    return (
      <Panel title="Sandbox Vars" sub={path}>
        <p className="text-pz-danger text-sm">{error ?? "Failed to read sandbox vars."}</p>
      </Panel>
    );
  }

  const totalKeys = sections?.reduce((n, s) => n + s.entries.length, 0) ?? 0;

  return (
    <Panel
      title="Sandbox Vars"
      sub={`${prefix}_SandboxVars.lua · ${totalKeys} KEYS`}
      dense
      bodyClassName="p-0"
    >
      <div className="p-2 border-b border-pz-border-lo flex items-center gap-2 flex-wrap">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-[200px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
          placeholder="search section / key / value..."
        />
        <span className="pz-mono text-[10.5px] text-pz-muted">{path}</span>
      </div>
      <div className="max-h-[65vh] overflow-y-auto">
        {visibleSections.length === 0 && (
          <div className="p-4 text-pz-muted text-xs text-center">No sandbox vars match.</div>
        )}
        {visibleSections.map((s) => (
          <section key={s.name} className="border-b border-pz-border-lo">
            <div className="px-3 py-1.5 bg-pz-bg-1">
              <span className="pz-label">{renderSectionLabel(s.name)}</span>
              <span className="pz-mono text-[10.5px] text-pz-muted ml-2">{s.entries.length}</span>
            </div>
            <table className="pz-table text-xs">
              <thead>
                <tr>
                  <th className="w-[280px]">Key</th>
                  <th>Value</th>
                  <th className="w-[80px]">Kind</th>
                </tr>
              </thead>
              <tbody>
                {s.entries.map((e) => (
                  <tr key={`${s.name}.${e.key}`}>
                    <td className="pz-mono text-pz-text align-top">{e.key}</td>
                    <td className="pz-mono text-pz-text-dim break-all whitespace-pre-wrap align-top">
                      {formatValue(e.value, e.kind)}
                    </td>
                    <td className="pz-mono text-[10.5px] text-pz-muted uppercase align-top">
                      {e.kind}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Panel>
  );
}
