import Link from "next/link";
import { signOut } from "@/auth";
import type { SessionInfo } from "@/lib/auth/session";
import { TopbarTitle } from "./topbar-title";

export function Topbar({ session }: { session: SessionInfo | null }) {
  return (
    <header className="topbar">
      <TopbarTitle />
      <div className="topbar-trail">
        <span className="live-dot" title="Connected" />
        {session ? (
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button type="submit" className="topbar-user">
              {session.discordId.slice(0, 6)}… ({session.role})
            </button>
          </form>
        ) : (
          <Link href="/api/auth/signin/discord" className="topbar-login">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
