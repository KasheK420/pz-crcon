import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { PlayerProfile } from "@/components/players/player-profile";

export const dynamic = "force-dynamic";

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");
  if (!atLeast(session.role, "VIEWER")) {
    return (
      <div className="p-8">
        <h1 className="pz-display-h text-2xl text-pz-text">Access denied</h1>
        <p className="text-pz-muted mt-2">Player profile requires VIEWER role or higher.</p>
      </div>
    );
  }
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pz-display-h text-xl tracking-widest">
          PLAYER <span className="text-pz-primary">{"//"}</span> PROFILE
        </div>
        <Link
          href="/admin/players"
          className="pz-pill pz-mono cursor-pointer"
        >
          ← all players
        </Link>
        <span className="pz-pill pz-mono">{session.role}</span>
      </div>
      <PlayerProfile playerId={id} role={session.role} />
    </div>
  );
}
