import Link from "next/link";
import { NAV } from "./nav-config";
import { atLeast, type Role } from "@/lib/auth/role";

export function Sidebar({
  role,
  currentPath,
}: {
  role: Role | null;
  currentPath: string;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand stencil">PZ-CRCON</div>
      {NAV.map((group) => {
        const visible = group.items.filter(
          (it) =>
            it.minRole === null || (role && atLeast(role, it.minRole))
        );
        if (visible.length === 0) return null;
        return (
          <div key={group.label} className="sidebar-group">
            <div className="sidebar-group-label">{group.label}</div>
            {visible.map((it) => (
              <Link
                key={it.id}
                href={it.href}
                className={`sidebar-item ${currentPath === it.href ? "active" : ""}`}
              >
                {it.label}
              </Link>
            ))}
          </div>
        );
      })}
    </aside>
  );
}
