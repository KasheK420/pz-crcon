import { RealPzMap } from "@/components/map/real-pz-map";
import { Panel } from "@/components/pz/panel";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Legacy iframe-based Knox map. Kept around as a fallback / quick
 * comparison view while the Leaflet map matures.
 */
export default function MapLegacyPage() {
  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="pz-display-h text-xl tracking-widest">
          KNOX COUNTY <span className="text-pz-primary">{"//"}</span> LEGACY VIEW
        </h1>
        <Link
          href="/"
          className="pz-pill hover:border-pz-border-hi"
          style={{ fontSize: 11 }}
        >
          ← back to live map
        </Link>
      </div>
      <Panel
        title="map.projectzomboid.com"
        sub="IFRAME FALLBACK"
        dense
        bodyClassName="p-0"
      >
        <div style={{ height: "75vh" }}>
          <RealPzMap />
        </div>
      </Panel>
    </main>
  );
}
