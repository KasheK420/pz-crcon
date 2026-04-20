import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { WhitelistTable } from "@/components/whitelist/whitelist-table";

export const dynamic = "force-dynamic";

export default async function WhitelistPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");
  if (!atLeast(session.role, "ADMIN")) {
    return (
      <div className="p-8">
        <h1 className="pz-display-h text-2xl text-pz-text">Access denied</h1>
        <p className="text-pz-muted mt-2">Whitelist management requires ADMIN role or higher.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pz-display-h text-xl tracking-widest">
          WHITELIST <span className="text-pz-primary">{"//"}</span> ADMIN
        </div>
        <span className="pz-pill pz-mono">{session.role}</span>
      </div>
      <WhitelistTable />
    </div>
  );
}
