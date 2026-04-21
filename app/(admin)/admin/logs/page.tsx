import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { LogViewer } from "@/components/logs/log-viewer";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");
  if (!atLeast(session.role, "MODERATOR")) {
    return (
      <div className="p-8">
        <h1 className="pz-display-h text-2xl text-pz-text">Access denied</h1>
        <p className="text-pz-muted mt-2">
          Server logs require MODERATOR role or higher.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pz-display-h text-xl tracking-widest">
          SERVER <span className="text-pz-primary">{"//"}</span> CONSOLE
        </div>
        <span className="pz-pill pz-mono">{session.role}</span>
        <span className="pz-pill pz-mono text-pz-muted">
          docker logs -f pz-server
        </span>
      </div>
      <LogViewer />
    </div>
  );
}
