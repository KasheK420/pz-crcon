import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { Panel } from "@/components/pz/panel";
import { LiveDot } from "@/components/pz/live-dot";
import { envMapFrom, inspectContainer } from "@/lib/docker/client";

export const dynamic = "force-dynamic";

const PZ_CONTAINER = process.env.PZ_CONTAINER_NAME ?? "pz-server";

interface EnvRow {
  key: string;
  value: string;
  category: "rcon" | "server" | "steam" | "memory" | "world" | "other";
  sensitive: boolean;
}

function classifyEnv(key: string): EnvRow["category"] {
  if (/^RCON_/i.test(key)) return "rcon";
  if (/^STEAM/i.test(key)) return "steam";
  if (/PASSWORD|TOKEN|SECRET/i.test(key)) return "server";
  if (/MEM|RAM|HEAP|JVM|XMS|XMX/i.test(key)) return "memory";
  if (/MAP|WORLD|MOD|WORKSHOP/i.test(key)) return "world";
  if (/SERVER|PORT|PUBLIC|ADMIN|MAX|PVP|PAUSE|OPEN|WHITELIST|HOST|NAME|CONFIG/i.test(key))
    return "server";
  return "other";
}

function isSensitive(key: string): boolean {
  return /PASSWORD|TOKEN|SECRET|KEY/i.test(key);
}

export default async function StartupPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin/discord");
  if (!atLeast(session.role, "OWNER")) {
    return (
      <div className="p-8">
        <h1 className="pz-display-h text-2xl text-pz-text">Access denied</h1>
        <p className="text-pz-muted mt-2">Startup configuration requires OWNER role.</p>
      </div>
    );
  }

  const info = await inspectContainer(PZ_CONTAINER);
  const env = info ? envMapFrom(info) : {};
  const rows: EnvRow[] = Object.entries(env)
    .map(([key, value]) => ({
      key,
      value,
      category: classifyEnv(key),
      sensitive: isSensitive(key),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const cmd = info?.Config?.Cmd ?? [];
  const entrypoint = info?.Config?.Entrypoint ?? [];
  const image = info?.Config?.Image ?? "—";
  const startedAt = info?.State?.StartedAt;
  const restartPolicy = info?.HostConfig?.RestartPolicy?.Name ?? "—";
  const binds = info?.HostConfig?.Binds ?? [];

  const grouped = rows.reduce<Record<string, EnvRow[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

  const categoryOrder: EnvRow["category"][] = [
    "rcon",
    "server",
    "world",
    "memory",
    "steam",
    "other",
  ];
  const categoryLabels: Record<EnvRow["category"], string> = {
    rcon: "RCON",
    server: "Server",
    world: "World / Mods",
    memory: "Memory / JVM",
    steam: "Steam",
    other: "Other",
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pz-display-h text-xl tracking-widest">
          STARTUP <span className="text-pz-primary">{"//"}</span> CONFIG
        </div>
        <span className="pz-pill pz-mono">{session.role}</span>
        {info ? (
          <LiveDot
            variant={info.State?.Running ? "live" : "down"}
            label={info.State?.Status?.toUpperCase() ?? "UNKNOWN"}
          />
        ) : (
          <LiveDot variant="down" label="NO CONTAINER" />
        )}
      </div>

      <div className="bg-pz-bg-1 border border-pz-border-lo px-3 py-2 text-[12px] text-pz-text-dim">
        <strong className="text-pz-text">Read-only.</strong> Changes to environment variables or
        launch flags require recreating the container (e.g.{" "}
        <code className="pz-mono">docker compose up -d --force-recreate pz-server</code>). For
        per-runtime live changes use the RCON <code className="pz-mono">changeoption</code> command.{" "}
        <Link
          href="https://pzwiki.net/wiki/Server_settings"
          target="_blank"
          rel="noreferrer noopener"
          className="text-pz-primary underline"
        >
          PZ wiki: Server settings
        </Link>
        .
      </div>

      {!info && (
        <Panel title="Container not found" sub={PZ_CONTAINER}>
          <p className="text-pz-muted text-xs">
            Could not inspect container <code>{PZ_CONTAINER}</code>. Make sure the Docker socket is
            mounted into pz-crcon and the container is named correctly. Override with{" "}
            <code className="pz-mono">PZ_CONTAINER_NAME</code> env var.
          </p>
        </Panel>
      )}

      {info && (
        <>
          <Panel title="Container" sub={PZ_CONTAINER} dense>
            <table className="pz-table text-xs">
              <tbody>
                <Row label="Image" value={image} mono />
                <Row label="Entrypoint" value={entrypoint?.join(" ") || "—"} mono />
                <Row label="Cmd" value={cmd.join(" ") || "—"} mono />
                <Row label="Restart policy" value={restartPolicy} />
                <Row
                  label="Started"
                  value={startedAt ? new Date(startedAt).toLocaleString() : "—"}
                />
                <Row label="Volumes" value={binds.length === 0 ? "—" : binds.join("\n")} mono pre />
              </tbody>
            </table>
          </Panel>

          {categoryOrder.map((cat) => {
            const items = grouped[cat] ?? [];
            if (items.length === 0) return null;
            return (
              <Panel
                key={cat}
                title={`Env · ${categoryLabels[cat]}`}
                sub={`${items.length} VAR${items.length === 1 ? "" : "S"}`}
                dense
              >
                <table className="pz-table text-xs">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.key}>
                        <td className="pz-mono text-pz-text">{r.key}</td>
                        <td className="pz-mono text-pz-text-dim break-all whitespace-pre-wrap">
                          {r.sensitive ? (
                            <span className="text-pz-amber">●●●●● (hidden — sensitive)</span>
                          ) : (
                            r.value || <em className="text-pz-muted">empty</em>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            );
          })}
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  pre,
}: {
  label: string;
  value: string;
  mono?: boolean;
  pre?: boolean;
}) {
  return (
    <tr>
      <td className="text-pz-muted w-[160px]">{label}</td>
      <td
        className={`${mono ? "pz-mono " : ""}${pre ? "whitespace-pre-wrap " : ""}text-pz-text-dim break-all`}
      >
        {value}
      </td>
    </tr>
  );
}
