"use client";

/**
 * Client wrapper that dynamic-imports the Leaflet map. Leaflet touches
 * `window` at module-load, so it can't be SSR'd — splitting it out lets
 * the rest of the public page stay server-rendered.
 */

import dynamic from "next/dynamic";

const KnoxMap = dynamic(
  () => import("./knox-map").then((m) => m.KnoxMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full grid place-items-center bg-pz-bg-deep text-pz-muted pz-mono text-xs">
        Loading Knox County map…
      </div>
    ),
  }
);

export default function KnoxMapDynamic() {
  return <KnoxMap />;
}
