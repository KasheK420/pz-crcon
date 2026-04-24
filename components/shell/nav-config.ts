import type { Role } from "@/lib/auth/role";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** Lowest role allowed to see this item. null = public. */
  minRole: Role | null;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "PUBLIC",
    items: [{ id: "map", label: "Live Map", href: "/", minRole: null }],
  },
  {
    label: "ADMIN",
    items: [
      { id: "overview", label: "Overview", href: "/admin", minRole: "VIEWER" },
      {
        id: "rcon",
        label: "RCON Terminal",
        href: "/admin/rcon",
        minRole: "MODERATOR",
      },
      {
        id: "players",
        label: "Players",
        href: "/admin/players",
        minRole: "VIEWER",
      },
      {
        id: "whitelist",
        label: "Whitelist",
        href: "/admin/whitelist",
        minRole: "ADMIN",
      },
      {
        id: "mods",
        label: "Mods",
        href: "/admin/mods",
        minRole: "VIEWER",
      },
      {
        id: "logs",
        label: "Server Logs",
        href: "/admin/logs",
        minRole: "MODERATOR",
      },
      {
        id: "config",
        label: "Server Config",
        href: "/admin/config",
        minRole: "VIEWER",
      },
      {
        id: "backups",
        label: "Backups",
        href: "/admin/backups",
        minRole: "VIEWER",
      },
      {
        id: "schedules",
        label: "Schedules",
        href: "/admin/schedules",
        minRole: "VIEWER",
      },
      {
        id: "startup",
        label: "Startup Config",
        href: "/admin/startup",
        minRole: "OWNER",
      },
      {
        id: "settings",
        label: "Settings",
        href: "/admin/settings",
        minRole: "VIEWER",
      },
    ],
  },
];
