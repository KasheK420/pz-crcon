import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { TweaksPanel } from "@/components/shell/tweaks-panel";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/signin/discord");
  }
  // Sidebar + TopbarTitle now read the live pathname via `usePathname()`
  // as client components; we no longer thread `currentPath` through the
  // layout (it was stale across client-side `<Link>` navigations).
  return (
    <>
      <div className="shell">
        <Sidebar role={session.role} />
        <div className="main">
          <Topbar session={session} />
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
