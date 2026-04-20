import { signOut } from "@/auth";
import type { SessionInfo } from "@/lib/auth/session";

export function Topbar({
  title,
  session,
}: {
  title: string;
  session: SessionInfo | null;
}) {
  return (
    <header className="topbar">
      <h1 className="topbar-title stencil">{title}</h1>
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
          <a href="/api/auth/signin/discord" className="topbar-login">
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}
