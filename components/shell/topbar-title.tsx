"use client";

import { usePathname } from "next/navigation";

// Same pathname-driven title the server-side helper used to produce, but
// computed on the client so it updates on every `<Link>` navigation
// instead of being frozen at initial SSR. Order matters — longer prefixes
// first so `/admin/players/abc` doesn't get matched as `/admin`.
const RULES: Array<{ match: (p: string) => boolean; title: string }> = [
  { match: (p) => p.startsWith("/admin/players/") && p !== "/admin/players", title: "Player Profile" },
  { match: (p) => p === "/admin/rcon", title: "RCON Terminal" },
  { match: (p) => p === "/admin/players", title: "Players" },
  { match: (p) => p === "/admin/whitelist", title: "Whitelist" },
  { match: (p) => p === "/admin/mods", title: "Mods" },
  { match: (p) => p === "/admin/logs", title: "Server Logs" },
  { match: (p) => p === "/admin/config", title: "Server Config" },
  { match: (p) => p === "/admin/backups", title: "Backups" },
  { match: (p) => p === "/admin/schedules", title: "Schedules" },
  { match: (p) => p === "/admin/startup", title: "Startup Config" },
  { match: (p) => p === "/admin/settings", title: "Settings" },
  { match: (p) => p === "/admin", title: "Overview" },
];

export function TopbarTitle() {
  const pathname = usePathname() ?? "/admin";
  const rule = RULES.find((r) => r.match(pathname));
  return <h1 className="topbar-title stencil">{rule?.title ?? "Admin"}</h1>;
}
