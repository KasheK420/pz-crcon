import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { StatusCards } from "@/components/overview/status-cards";
import { ActivityFeed } from "@/components/overview/activity-feed";
import { QuickActions } from "@/components/overview/quick-actions";
import { PlayersTable } from "@/components/players/table";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");

  return (
    <div className="flex flex-col gap-4">
      <StatusCards />

      <QuickActions role={session.role} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4">
        <PlayersTable
          role={session.role}
          onlineOnly
          title="Online Players"
        />
        <ActivityFeed />
      </div>
    </div>
  );
}
