/**
 * Real Project Zomboid Knox County map embedded from pzmap.crash-override.net.
 * Public, free, community-maintained tile server. Live player positions
 * land in Phase 4 once the Lua mod ships and we render an overlay.
 */
export function RealPzMap({ className }: { className?: string }) {
  return (
    <iframe
      src="https://map.projectzomboid.com/?#0.30,0.30,1500"
      title="Knox County map"
      className={`w-full h-full border-0 bg-pz-bg-deep ${className ?? ""}`}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
