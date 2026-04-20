"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/pz/panel";
import { describeIni, INI_GROUP_LABELS, type IniGroup } from "@/lib/pz/ini-descriptors";

interface Props {
  ok: boolean;
  path: string;
  prefix: string;
  error?: string;
  entries?: { key: string; value: string }[];
}

export function ServerIniTab({ ok, path, prefix, error, entries }: Props) {
  const [filter, setFilter] = useState("");

  const grouped = useMemo(() => {
    if (!entries) return {} as Record<IniGroup, typeof entries>;
    const q = filter.trim().toLowerCase();
    const visible = q
      ? entries.filter((e) => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q))
      : entries;
    const out: Record<string, typeof entries> = {};
    for (const e of visible) {
      const { group } = describeIni(e.key);
      (out[group] ??= []).push(e);
    }
    return out as Record<IniGroup, typeof entries>;
  }, [entries, filter]);

  if (!ok) {
    return (
      <Panel title="Server INI" sub={path}>
        <p className="text-pz-danger text-sm">{error ?? "Failed to read server config."}</p>
      </Panel>
    );
  }

  const groupOrder: IniGroup[] = [
    "general",
    "capacity",
    "network",
    "gameplay",
    "whitelist",
    "mods",
    "voip",
    "logging",
    "other",
  ];

  return (
    <Panel
      title="Server INI"
      sub={`${prefix}.ini · ${entries?.length ?? 0} KEYS`}
      dense
      bodyClassName="p-0"
    >
      <div className="p-2 border-b border-pz-border-lo flex items-center gap-2 flex-wrap">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-[200px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
          placeholder="search key or value..."
        />
        <span className="pz-mono text-[10.5px] text-pz-muted">{path}</span>
      </div>
      <div className="max-h-[65vh] overflow-y-auto">
        {groupOrder.map((g) => {
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
                    <th className="w-[240px]">Key</th>
                    <th>Value</th>
                    <th className="w-[48px]" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => {
                    const d = describeIni(e.key);
                    return (
                      <tr key={e.key}>
                        <td className="pz-mono text-pz-text align-top">
                          <div>{e.key}</div>
                          <div className="text-[10.5px] text-pz-muted font-sans mt-0.5">
                            {d.description}
                          </div>
                        </td>
                        <td className="pz-mono text-pz-text-dim break-all whitespace-pre-wrap align-top">
                          {e.value.length > 0 ? e.value : <em className="text-pz-muted">empty</em>}
                        </td>
                        <td className="align-top">
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
  );
}
