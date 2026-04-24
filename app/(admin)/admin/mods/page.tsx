import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { ModsManager } from "@/components/mods/mods-manager";

export const dynamic = "force-dynamic";

export default async function ModsPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");
  if (!atLeast(session.role, "VIEWER")) {
    return (
      <div className="p-8">
        <h1 className="pz-display-h text-2xl text-pz-text">Access denied</h1>
        <p className="text-pz-muted mt-2">Mod manager requires VIEWER role or higher.</p>
      </div>
    );
  }

  const canEdit = atLeast(session.role, "ADMIN");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pz-display-h text-xl tracking-widest">
          MODS <span className="text-pz-primary">{"//"}</span> WORKSHOP
        </div>
        <span className="pz-pill pz-mono">{session.role}</span>
        {canEdit ? (
          <span className="pz-pill pz-mono live">EDIT</span>
        ) : (
          <span className="pz-pill pz-mono" title="ADMIN required to change mods">
            READ-ONLY
          </span>
        )}
      </div>
      <ModsManager role={session.role} />
    </div>
  );
}
