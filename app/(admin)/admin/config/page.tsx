import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { ConfigTabs } from "@/components/config/config-tabs";
import { readSandboxVars, readServerIni } from "@/lib/pz/config-reader";

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

  const [ini, sandbox] = await Promise.all([readServerIni(), readSandboxVars()]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pz-display-h text-xl tracking-widest">
          SERVER <span className="text-pz-primary">{"//"}</span> CONFIG
        </div>
        <span className="pz-pill pz-mono">{session.role}</span>
        <span className="pz-pill pz-mono text-pz-muted">{ini.prefix}.ini</span>
      </div>

      <div className="bg-pz-bg-1 border border-pz-border-lo px-3 py-2 text-[12px] text-pz-text-dim">
        <strong className="text-pz-text">Read-only.</strong> Editing lands in Phase 2 (v0.2.0). To
        change a value today: edit the file on disk and run RCON{" "}
        <code className="pz-mono">reloadoptions</code>, or use{" "}
        <code className="pz-mono">changeoption</code> for live tweaks.{" "}
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

      <ConfigTabs
        ini={{
          ok: ini.ok,
          path: ini.path,
          prefix: ini.prefix,
          error: ini.error,
          entries: ini.parsed?.entries.map((e) => ({
            key: e.key,
            value: e.value,
          })),
        }}
        sandbox={{
          ok: sandbox.ok,
          path: sandbox.path,
          prefix: sandbox.prefix,
          error: sandbox.error,
          sections: sandbox.parsed?.sections,
        }}
      />
    </div>
  );
}
