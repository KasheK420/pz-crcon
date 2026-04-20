import { Panel } from "@/components/pz/panel";

interface Mod {
  workshopId: string;
  modId: string;
  name: string;
  version: string | null;
}

function abbr(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function ModGrid({ mods }: { mods: Mod[] }) {
  return (
    <Panel
      title="Active Mods"
      sub={`${mods.length} ENABLED`}
      dense
    >
      {mods.length === 0 ? (
        <div className="p-6 text-center text-pz-muted text-sm">
          No mods registered yet. Mod metadata syncs once the server connects.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 p-2.5 max-h-[260px] overflow-y-auto">
          {mods.map((m) => (
            <div key={m.workshopId} className="pz-mod-item">
              <div className="pz-mod-abbr">{abbr(m.name)}</div>
              <div className="flex flex-col min-w-0 flex-1">
                <div className="pz-mod-name">{m.name}</div>
                <div className="pz-mod-ver">
                  {m.version ? `v${m.version}` : `wid:${m.workshopId}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
