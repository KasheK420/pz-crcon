import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { TweaksPanel } from "@/components/shell/tweaks-panel";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/signin/discord");
  }
  const h = await headers();
  const path = h.get("x-pathname") ?? "/admin";
  return (
    <>
      <div className="shell">
        <Sidebar role={session.role} currentPath={path} />
        <div className="main">
          <Topbar title={titleFor(path)} session={session} />
          <div className="page-content">{children}</div>
        </div>
        <TweaksPanel />
      </div>
      <div className="app-fx">
        <div className="grain" />
        <div className="scanlines" />
        <div className="vignette" />
      </div>
    </>
  );
}

function titleFor(path: string): string {
  if (path === "/admin") return "Overview";
  if (path === "/admin/rcon") return "RCON Terminal";
  if (path === "/admin/players") return "Players";
  if (path === "/admin/whitelist") return "Whitelist";
  if (path === "/admin/logs") return "Server Logs";
  if (path === "/admin/config") return "Server Config";
  if (path === "/admin/startup") return "Startup Config";
  return "Admin";
}
