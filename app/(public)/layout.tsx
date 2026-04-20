import Link from "next/link";
import { getSession } from "@/lib/auth/session";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  return (
    <>
      <header className="sticky top-0 z-30 backdrop-blur bg-pz-bg/70 border-b border-pz-border">
        <div className="mx-auto max-w-[1600px] px-6 h-12 flex items-center justify-between">
          <Link href="/" className="font-display text-pz-primary text-lg tracking-wider">
            PZ-CRCON
          </Link>
          <div className="flex items-center gap-4 text-xs">
            {session ? (
              <Link
                href="/admin"
                className="pz-pill live"
              >
                ADMIN PANEL ({session.role})
              </Link>
            ) : (
              <Link
                href="/api/auth/signin/discord"
                className="pz-pill"
                style={{
                  background: "#5865f2",
                  color: "white",
                  textDecoration: "none",
                }}
              >
                Sign in with Discord
              </Link>
            )}
          </div>
        </div>
      </header>
      {children}
      <div className="app-fx">
        <div className="grain" />
        <div className="scanlines" />
        <div className="vignette" />
      </div>
    </>
  );
}
