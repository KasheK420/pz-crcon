"use client";

import { useMemo, useState } from "react";
import {
  RCON_COMMANDS,
  RCON_CATEGORIES,
  type RconCategory,
  type RconCommandSpec,
} from "@/lib/rcon/commands";
import { atLeast, type Role } from "@/lib/auth/role";
import { Panel } from "@/components/pz/panel";

interface Props {
  role: Role;
  /** Optional callback fired when the user clicks "Insert" on an example. */
  onInsert?: (text: string) => void;
}

export function CheatSheet({ role, onInsert }: Props) {
  const [filter, setFilter] = useState("");
  const [openCats, setOpenCats] = useState<Record<string, boolean>>(() => {
    // Default: all open if no filter. We just open all initially.
    const init: Record<string, boolean> = {};
    for (const c of RCON_CATEGORIES) init[c.key] = true;
    return init;
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return RCON_COMMANDS;
    return RCON_COMMANDS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.signature.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [filter]);

  const grouped: Record<RconCategory, RconCommandSpec[]> = useMemo(() => {
    const map: Record<string, RconCommandSpec[]> = {};
    for (const c of RCON_CATEGORIES) map[c.key] = [];
    for (const cmd of filtered) {
      (map[cmd.category] ??= []).push(cmd);
    }
    return map as Record<RconCategory, RconCommandSpec[]>;
  }, [filtered]);

  function toggle(key: string) {
    setOpenCats((s) => ({ ...s, [key]: !s[key] }));
  }

  return (
    <Panel title="Command Reference" sub="PZ RCON" dense bodyClassName="p-0">
      <div className="p-2 border-b border-pz-border-lo">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
          placeholder="search name / desc / category..."
        />
      </div>
      <div className="max-h-[640px] overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-4 text-pz-muted text-xs text-center">
            No commands match your filter.
          </div>
        )}
        {RCON_CATEGORIES.map((cat) => {
          const items = grouped[cat.key] ?? [];
          if (items.length === 0) return null;
          const isOpen = openCats[cat.key] !== false;
          return (
            <section key={cat.key} className="border-b border-pz-border-lo">
              <button
                type="button"
                onClick={() => toggle(cat.key)}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-pz-bg-1 hover:bg-pz-bg-2 cursor-pointer"
              >
                <span className="text-[10px] pz-mono text-pz-muted w-3">{isOpen ? "▾" : "▸"}</span>
                <span className="pz-label">{cat.label}</span>
                <span className="ml-auto text-[10px] pz-mono text-pz-muted">{items.length}</span>
              </button>
              {isOpen && (
                <ul>
                  {items.map((c) => {
                    const allowed = atLeast(role, c.requires);
                    const example = c.examples?.[0];
                    return (
                      <li
                        key={c.name}
                        className={`flex flex-col gap-0.5 px-3 py-2 border-t border-dashed border-pz-border-lo ${
                          !allowed ? "opacity-40" : ""
                        }`}
                        title={!allowed ? `Requires ${c.requires}+ role` : c.description}
                      >
                        <div className="flex items-center gap-2">
                          <span className="pz-mono text-[12px] text-pz-primary">{c.name}</span>
                          <span
                            className={`text-[9.5px] pz-mono uppercase tracking-wider px-1 py-px border ${
                              allowed
                                ? "border-pz-border-lo text-pz-muted"
                                : "border-pz-border-lo text-pz-danger"
                            }`}
                          >
                            {c.requires}
                          </span>
                        </div>
                        <div className="pz-mono text-[10.5px] text-pz-text-dim break-all">
                          {c.signature}
                        </div>
                        <div className="text-[11px] text-pz-text-dim">{c.description}</div>
                        {example && (
                          <button
                            type="button"
                            disabled={!allowed || !onInsert}
                            onClick={() => onInsert?.(example)}
                            className="self-start mt-1 text-[10.5px] pz-mono px-1.5 py-0.5 border border-pz-border-lo hover:border-pz-border-hi text-pz-text-dim hover:text-pz-text cursor-pointer disabled:cursor-not-allowed disabled:hover:text-pz-text-dim disabled:hover:border-pz-border-lo"
                            title={
                              !allowed
                                ? "Insufficient role"
                                : !onInsert
                                  ? "Insert disabled"
                                  : "Insert into terminal"
                            }
                          >
                            ↵ Insert {example}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Panel>
  );
}
