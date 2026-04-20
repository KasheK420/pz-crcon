"use client";

import { useRef } from "react";
import type { Role } from "@/lib/auth/role";
import { RconTerminal, type RconTerminalHandle } from "./terminal";
import { CheatSheet } from "./cheat-sheet";

/**
 * Glue component that gives the cheat sheet a way to "Insert" example commands
 * into the terminal's input field. Server pages render this client shell.
 */
export function RconShell({ role }: { role: Role }) {
  const termRef = useRef<RconTerminalHandle>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
      <RconTerminal ref={termRef} role={role} />
      <CheatSheet role={role} onInsert={(text) => termRef.current?.insertCommand(text)} />
    </div>
  );
}
