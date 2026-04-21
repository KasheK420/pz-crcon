import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { ConfigTabs } from "@/components/config/config-tabs";
import { ServerControlsCard } from "@/components/server/server-controls-card";
import { checkConfigAccess } from "@/lib/pz/access-check";

export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");
  if (!atLeast(session.role, "VIEWER")) {
    return (
      <div className="p-8">
        <h1 className="pz-display-h text-2xl text-pz-text">Access denied</h1>
        <p className="text-pz-muted mt-2">Server config requires VIEWER role.</p>
      </div>
    );
  }

  // Probe FS readiness up-front so the page can surface a helpful banner
  // if the config volume isn't mounted / the uid:gid permissions are off.
  // The client tabs also tolerate a 503 from their own GET, but this
  // banner gives operators a concrete diagnosis string.
  const access = await checkConfigAccess();
  const canEdit = atLeast(session.role, "OWNER");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pz-display-h text-xl tracking-widest">
          SERVER <span className="text-pz-primary">{"//"}</span> CONFIG
        </div>
        <span className="pz-pill pz-mono">{session.role}</span>
        {canEdit ? (
          <span className="pz-pill pz-mono live">EDIT</span>
        ) : (
          <span
            className="pz-pill pz-mono"
            title="OWNER required to save changes"
          >
            READ-ONLY
          </span>
        )}
      </div>

      {!access.ok && (
        <div className="bg-pz-danger/15 border border-pz-danger text-pz-text text-[12px] px-3 py-2">
          <strong className="pz-display-h text-pz-danger">
            Config volume unreachable.
          </strong>{" "}
          Reads and writes will fail until fixed.{" "}
          <span className="pz-mono text-pz-muted">
            dir={access.dir}
            {access.reason ? ` · reason=${access.reason}` : ""}
          </span>
        </div>
      )}

      <div className="bg-pz-bg-1 border border-pz-border-lo px-3 py-2 text-[12px] text-pz-text-dim">
        <strong className="text-pz-text">Tip.</strong> OWNERs can edit both
        files here; saves are atomic with a per-file{" "}
        <code className="pz-mono">.backups/</code> snapshot and an
        optimistic-concurrency mtime check. Most keys require a PZ server
        restart to take effect — after saving, the &quot;Restart now&quot;
        prompt appears and you can also use the lifecycle controls below.{" "}
        <Link
          href="https://pzwiki.net/wiki/Server_settings"
          target="_blank"
          rel="noreferrer noopener"
          className="text-pz-primary underline"
        >
          Server settings
        </Link>{" "}
        ·{" "}
        <Link
          href="https://pzwiki.net/wiki/Sandbox"
          target="_blank"
          rel="noreferrer noopener"
          className="text-pz-primary underline"
        >
          Sandbox vars
        </Link>
        .
      </div>

      {atLeast(session.role, "ADMIN") && (
        <ServerControlsCard role={session.role} />
      )}

      <ConfigTabs role={session.role} />
    </div>
  );
}
