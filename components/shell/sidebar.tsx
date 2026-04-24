"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav-config";
import { atLeast, type Role } from "@/lib/auth/role";

// The sidebar is intentionally a client component. The `currentPath`
// prop (previously passed from the server layout via the `x-pathname`
// middleware header) only updates on a full server re-render, but the
// App Router caches layouts across client-side `<Link>` navigations —
// so clicking a nav entry swapped the page without ever re-running
// the layout, leaving the "active" highlight stuck on the initial
// path. `usePathname()` is a client hook that always reflects the
// live URL, so the highlight moves with the user immediately.
export function Sidebar({ role }: { role: Role | null }) {
  const currentPath = usePathname() ?? "/";
  return (
    <aside className="sidebar">
      <div className="sidebar-brand stencil">PZ-CRCON</div>
      {NAV.map((group) => {
        const visible = group.items.filter(
          (it) =>
            it.minRole === null || (role && atLeast(role, it.minRole)),
        );
        if (visible.length === 0) return null;
        return (
          <div key={group.label} className="sidebar-group">
            <div className="sidebar-group-label">{group.label}</div>
            {visible.map((it) => {
              // Exact match for "/" (public landing) and "/admin"
              // (overview) — otherwise sub-routes like /admin/players/123
              // should still highlight the "Players" entry. Match with a
              // trailing-slash / prefix test so /admin doesn't bleed
              // into /admin/rcon.
              const active =
                it.href === "/"
                  ? currentPath === "/"
                  : it.href === "/admin"
                    ? currentPath === "/admin"
                    : currentPath === it.href ||
                      currentPath.startsWith(it.href + "/");
              return (
                <Link
                  key={it.id}
                  href={it.href}
                  className={`sidebar-item ${active ? "active" : ""}`}
                >
                  {it.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </aside>
  );
}
