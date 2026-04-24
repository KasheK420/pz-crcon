import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { SchedulesManager } from "@/components/schedules/schedules-manager";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");
  if (!atLeast(session.role, "VIEWER")) {
    return (
      <div className="p-8">
        <h1 className="pz-display-h text-2xl text-pz-text">Access denied</h1>
        <p className="text-pz-muted mt-2">Schedules require VIEWER role or higher.</p>
      </div>
    );
  }
  const canEdit = atLeast(session.role, "ADMIN");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pz-display-h text-xl tracking-widest">
          SCHEDULES <span className="text-pz-primary">{"//"}</span> CRON
        </div>
        <span className="pz-pill pz-mono">{session.role}</span>
        {canEdit ? (
          <span className="pz-pill pz-mono live">EDIT</span>
        ) : (
          <span className="pz-pill pz-mono">READ-ONLY</span>
        )}
      </div>
      <SchedulesManager role={session.role} />
    </div>
  );
}
