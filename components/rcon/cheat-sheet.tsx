"use client";

import { useState } from "react";
import { RCON_COMMANDS } from "@/lib/rcon/commands";
import { atLeast, type Role } from "@/lib/auth/role";
import { Panel } from "@/components/pz/panel";

export function CheatSheet({ role }: { role: Role }) {
  const [filter, setFilter] = useState("");
  const visible = RCON_COMMANDS.filter(
    (c) =>
      atLeast(role, c.requires) &&
      (!filter || c.name.includes(filter) || c.description.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <Panel title="Command Reference" sub="PZ RCON" dense>
      <div className="p-2 border-b border-pz-border-lo">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
          placeholder="filter commands..."
        />
      </div>
      <div className="max-h-[520px] overflow-y-auto">
        {visible.length === 0 && (
          <div className="p-4 text-pz-muted text-xs text-center">
            No commands match your role or filter.
          </div>
        )}
        {visible.map((c) => (
          <div
            key={c.name}
            className="flex flex-col px-3 py-2 border-b border-dashed border-pz-border-lo"
          >
            <div className="pz-mono text-[11.5px] text-pz-primary">
              {c.signature}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] pz-mono text-pz-muted uppercase tracking-wider">
                {c.requires}
              </span>
              <span className="text-[11px] text-pz-text-dim">{c.description}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
