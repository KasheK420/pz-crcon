import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { PlayersTable } from "@/components/players/table";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pz-display-h text-xl tracking-widest">
          Player <span className="text-pz-primary">{"//"}</span> Management
        </div>
        <span className="pz-pill pz-mono">{session.role}</span>
      </div>
      <PlayersTable role={session.role} />
    </div>
  );
}
