/**
 * Static tactical map for Phase 1. Live player dots land in Phase 4 once
 * the Lua mod is streaming coordinates. Port of the design-reference SVG
 * stripped of mock player data and hover state.
 */
export function TacticalMap({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 800 500"
      preserveAspectRatio="xMidYMid meet"
      className={`pz-map ${className ?? ""}`}
      aria-label="Knox County tactical map"
    >
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="rgba(125,163,72,0.08)"
            strokeWidth="0.5"
          />
        </pattern>
        <pattern
          id="majorgrid"
          width="200"
          height="200"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 200 0 L 0 0 0 200"
            fill="none"
            stroke="rgba(125,163,72,0.16)"
            strokeWidth="0.75"
          />
        </pattern>
        <radialGradient id="terrainGlow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#14180f" />
          <stop offset="100%" stopColor="#07080a" />
        </radialGradient>
      </defs>

      <rect width="800" height="500" fill="url(#terrainGlow)" />
      <rect width="800" height="500" fill="url(#grid)" />
      <rect width="800" height="500" fill="url(#majorgrid)" />

      {/* Rivers (stylised) */}
      <path
        d="M -10 180 C 120 160, 220 220, 340 200 S 560 260, 700 240 L 810 250 L 810 275 L 700 265 S 560 285, 340 225 S 120 185, -10 205 Z"
        fill="rgba(94,138,168,0.14)"
        stroke="rgba(94,138,168,0.42)"
        strokeWidth="0.5"
      />

      {/* Roads */}
      <path
        d="M 0 260 L 800 260"
        stroke="rgba(212,160,23,0.42)"
        strokeWidth="1.3"
        strokeDasharray="8 6"
      />
      <path
        d="M 400 0 L 400 500"
        stroke="rgba(212,160,23,0.28)"
        strokeWidth="1"
        strokeDasharray="6 4"
      />

      {/* Major town labels */}
      {[
        { x: 150, y: 310, name: "ROSEWOOD" },
        { x: 380, y: 140, name: "MULDRAUGH" },
        { x: 620, y: 320, name: "WEST POINT" },
        { x: 560, y: 90, name: "RIVERSIDE" },
        { x: 230, y: 430, name: "MARCH RIDGE" },
        { x: 720, y: 440, name: "LOUISVILLE" },
      ].map((t) => (
        <g key={t.name}>
          <circle
            cx={t.x}
            cy={t.y}
            r="3"
            fill="var(--color-pz-primary)"
            opacity="0.7"
          />
          <text
            x={t.x + 8}
            y={t.y + 4}
            fill="var(--color-pz-text-dim)"
            fontFamily="Oswald, sans-serif"
            fontSize="11"
            letterSpacing="0.14em"
          >
            {t.name}
          </text>
        </g>
      ))}

      {/* Compass */}
      <g transform="translate(740,60)">
        <circle r="22" fill="rgba(0,0,0,0.3)" stroke="rgba(125,163,72,0.3)" />
        <text
          y="-12"
          textAnchor="middle"
          fill="var(--color-pz-primary)"
          fontFamily="Oswald, sans-serif"
          fontSize="10"
          letterSpacing="0.2em"
        >
          N
        </text>
        <line
          x1="0"
          y1="-8"
          x2="0"
          y2="10"
          stroke="var(--color-pz-primary)"
          strokeWidth="1"
        />
      </g>

      {/* Scale bar */}
      <g transform="translate(40,460)">
        <line x1="0" y1="0" x2="160" y2="0" stroke="var(--color-pz-muted)" />
        <line x1="0" y1="-4" x2="0" y2="4" stroke="var(--color-pz-muted)" />
        <line x1="160" y1="-4" x2="160" y2="4" stroke="var(--color-pz-muted)" />
        <text
          x="80"
          y="16"
          textAnchor="middle"
          fill="var(--color-pz-muted)"
          fontFamily="JetBrains Mono, monospace"
          fontSize="9"
          letterSpacing="0.1em"
        >
          2 KM
        </text>
      </g>

      {/* Watermark */}
      <text
        x="400"
        y="488"
        textAnchor="middle"
        fill="var(--color-pz-muted)"
        fontFamily="JetBrains Mono, monospace"
        fontSize="9"
        letterSpacing="0.2em"
      >
        KNOX COUNTY · EXCLUSION ZONE · LIVE POSITIONS IN PHASE 4
      </text>
    </svg>
  );
}
