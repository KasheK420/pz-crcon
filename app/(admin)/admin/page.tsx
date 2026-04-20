import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { StatusCards } from "@/components/overview/status-cards";
import { ActivityFeed } from "@/components/overview/activity-feed";
import { QuickActions } from "@/components/overview/quick-actions";
import { PlayersTable } from "@/components/players/table";
import { JoinInfo } from "@/components/public/join-info";
import { AuditCard } from "@/components/audit/audit-card";
import { ServerControlsCard } from "@/components/server/server-controls-card";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");

  const serverAddress =
    process.env.PUBLIC_SERVER_ADDRESS ?? "pz.majorluk.pl:16261";
  const discordUrl = process.env.PUBLIC_DISCORD_URL ?? undefined;

  return (
    <div className="flex flex-col gap-4">
      <StatusCards />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QuickActions role={session.role} />
        {atLeast(session.role, "ADMIN") && (
          <ServerControlsCard role={session.role} />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4">
        <PlayersTable
          role={session.role}
          onlineOnly
          title="Online Players"
        />
        <div className="flex flex-col gap-4">
          <ActivityFeed />
          <JoinInfo address={serverAddress} discordUrl={discordUrl} />
        </div>
      </div>

      {atLeast(session.role, "MODERATOR") && <AuditCard />}
    </div>
  );
}
