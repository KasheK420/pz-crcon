import { Panel } from "@/components/pz/panel";

interface Mod {
  workshopId: string;
  modId: string;
  name: string;
  version: string | null;
  thumbnailUrl?: string | null;
}

const COLLECTION_URL =
  process.env.PUBLIC_WORKSHOP_COLLECTION_URL ?? undefined;

function abbr(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function workshopLink(id: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
}

export function ModGrid({ mods }: { mods: Mod[] }) {
  return (
    <Panel
      title="Active Mods"
      sub={`${mods.length} ENABLED`}
      right={
        COLLECTION_URL ? (
          <a
            href={COLLECTION_URL}
            target="_blank"
            rel="noreferrer"
            className="pz-pill"
            style={{ fontSize: 10, padding: "2px 8px" }}
          >
            View collection ↗
          </a>
        ) : null
      }
      dense
    >
      {mods.length === 0 ? (
        <div className="p-6 text-center text-pz-muted text-sm">
          No mods registered yet. Mod metadata syncs once the server connects.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 p-3 max-h-[420px] overflow-y-auto">
          {mods.map((m) => (
            <a
              key={m.workshopId}
              href={workshopLink(m.workshopId)}
              target="_blank"
              rel="noreferrer"
              className="group flex flex-col gap-1.5 bg-pz-bg-0 border border-pz-border-lo hover:border-pz-primary transition-colors p-2 no-underline"
              title={m.name}
            >
              {m.thumbnailUrl ? (
                <div
                  className="w-full bg-pz-bg-deep border border-pz-border-lo overflow-hidden"
                  style={{ aspectRatio: "1 / 1" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.thumbnailUrl}
                    alt={m.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div
                  className="w-full grid place-items-center bg-pz-bg-deep border border-pz-border-lo text-pz-muted font-mono text-xs"
                  style={{ aspectRatio: "1 / 1" }}
                >
                  {abbr(m.name)}
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <div className="text-[11px] font-medium text-pz-text leading-tight line-clamp-2 group-hover:text-pz-primary transition-colors">
                  {m.name}
                </div>
                <div className="text-[9px] text-pz-muted font-mono mt-0.5 truncate">
                  {m.version ? `v${m.version}` : `wid: ${m.workshopId}`}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </Panel>
  );
}
