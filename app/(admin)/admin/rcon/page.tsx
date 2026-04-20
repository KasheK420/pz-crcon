import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { RconTerminal } from "@/components/rcon/terminal";
import { CheatSheet } from "@/components/rcon/cheat-sheet";
import { LiveDot } from "@/components/pz/live-dot";

export const dynamic = "force-dynamic";

export default async function RconPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");
  if (!atLeast(session.role, "MODERATOR")) {
    return (
      <div className="p-8">
        <h1 className="pz-display-h text-2xl text-pz-text">Access denied</h1>
        <p className="text-pz-muted mt-2">
          RCON terminal requires MODERATOR role or higher.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pz-display-h text-xl tracking-widest">
          RCON <span className="text-pz-primary">{"//"}</span> TERMINAL
        </div>
        <span className="pz-pill live">
          <LiveDot variant="live" /> WS BRIDGE
        </span>
        <span className="pz-pill pz-mono">{session.role}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <RconTerminal role={session.role} />
        <CheatSheet role={session.role} />
      </div>
    </div>
  );
}
