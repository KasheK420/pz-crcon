import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { SettingsView } from "@/components/settings/settings-view";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");
  if (!atLeast(session.role, "VIEWER")) {
    return (
      <div className="p-8">
        <h1 className="pz-display-h text-2xl text-pz-text">Access denied</h1>
        <p className="text-pz-muted mt-2">Settings require VIEWER role or higher.</p>
      </div>
    );
  }
  const isOwner = atLeast(session.role, "OWNER");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pz-display-h text-xl tracking-widest">
          SETTINGS <span className="text-pz-primary">{"//"}</span> PANEL
        </div>
        <span className="pz-pill pz-mono">{session.role}</span>
        {isOwner && <span className="pz-pill pz-mono live">OWNER</span>}
      </div>
      <SettingsView role={session.role} />
    </div>
  );
}
