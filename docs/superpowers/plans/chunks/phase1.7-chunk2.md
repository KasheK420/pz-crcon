# Phase 1.7 — Chunk 2: Descriptors M2 (full coverage)

**Goal:** Full curated metadata for every B42 stock sandbox var (~130) and every documented server.ini key (~120). Mod-added sandbox keys handled by fallback at render time, not by failing coverage tests.

---

## Task 2.1 — Check in B42 stock fixtures

**Files:**
- Create: `data/pz/ServerSandboxOptions.lua`
- Create: `tests/fixtures/servertest-sandbox.lua`
- Create: `tests/fixtures/live-sandbox.lua`

- [ ] **Step 1: Source stock defaults.** Find the reference file shipped with the game:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@85.215.222.81 \
  "docker compose -f /opt/docker/projectzomboid/docker-compose.yml run --rm --no-deps --entrypoint sh pz-server -c 'find /home/steam/pz-dedicated -name ServerSandboxOptions.lua 2>/dev/null'"
```

Then copy it to `data/pz/ServerSandboxOptions.lua` via SCP.

- [ ] **Step 2: Snapshot live sandbox** into `tests/fixtures/live-sandbox.lua`:

```bash
ssh ... "cat /var/lib/docker/volumes/pz-data/_data/Server/MajorlukPZ_SandboxVars.lua" > tests/fixtures/live-sandbox.lua
```

- [ ] **Step 3: Generate the stock fixture programmatically** in Task 2.4 via `scripts/gen-servertest-fixture.ts` (parses `data/pz/ServerSandboxOptions.lua` and emits defaults).

- [ ] **Step 4: Commit**

```bash
git add data/pz/ServerSandboxOptions.lua tests/fixtures/live-sandbox.lua
git commit -m "chore(fixtures): B42 stock sandbox defaults + live MajorlukPZ snapshot"
```

---

## Task 2.2 — Extend `ini-descriptors.ts` with type metadata

**Files:**
- Modify: `lib/pz/ini-descriptors.ts`

- [ ] **Step 1:** Extend the interface to include `type`, `default`, `min`, `max`, `step`, `options`, `secret`:

```ts
export type IniValueType = "bool" | "int" | "float" | "string" | "enum" | "csv";

export interface IniDescriptor {
  group: IniGroup;
  description: string;
  type: IniValueType;
  default?: boolean | number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string | number; label: string; help?: string }>;
  secret?: boolean;
  requiresRestart?: boolean;
  wikiHash?: string;
}
```

- [ ] **Step 2:** Grow `INI_DESCRIPTORS` to full coverage. Seed the list from the live `MajorlukPZ.ini` on HomePL:

```bash
ssh ... "cat /var/lib/docker/volumes/pz-data/_data/Server/MajorlukPZ.ini | grep -E '^[A-Za-z_]+=' | cut -d= -f1 | sort -u"
```

For each key, author a descriptor record sourced from https://pzwiki.net/wiki/Server_settings. Mark `secret: true` on `RCONPassword`, `AdminPassword`, `ServerPassword`. Mark `requiresRestart: true` on ports, capacity, mods, `ResetID`, `Open`.

- [ ] **Step 3:** Keep `describeIni()` and `INI_GROUP_LABELS` public surface intact.

- [ ] **Step 4: Commit**

```bash
git add lib/pz/ini-descriptors.ts
git commit -m "feat(pz): full server.ini descriptor coverage with type metadata"
```

---

## Task 2.3 — Create `sandbox-descriptors.ts`

**Files:**
- Create: `lib/pz/sandbox-descriptors.ts`

- [ ] **Step 1:** Interface:

```ts
export type SandboxValueType = "bool" | "int" | "float" | "enum" | "string";

export interface SandboxDescriptor {
  path: string;                  // dot-path, matches parser flat keys ("Zombies.Speed")
  label: string;
  section: string;               // top-level table name
  subsection?: string;
  type: SandboxValueType;
  default: boolean | number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: number | string; label: string; help?: string }>;
  help: string;
  requiresRestart: boolean;      // all sandbox keys are restart-only today
}

export const SANDBOX_DESCRIPTORS: SandboxDescriptor[] = [
  // ~130 entries.
];

export function describeSandbox(path: string): SandboxDescriptor | undefined {
  // O(1) lookup via memoized map
}

export const SANDBOX_SECTIONS: Array<{ key: string; label: string; order: number }> = [
  { key: "Zombies", label: "Zombies", order: 1 },
  { key: "ZombieConfig", label: "Zombie config", order: 2 },
  { key: "Loot", label: "Loot", order: 3 },
  // ...
];
```

- [ ] **Step 2:** Author all ~130 entries. Organize by section with `// === Zombies ===` comment blocks. For enum keys (`Speed`, `Strength`, `Toughness`, `Cognition`, `Memory`, `Sight`, `Hearing`, `Transmission`) cite the PZ 5-tier scale. For multipliers, `min: 0.0, max: 4.0, step: 0.05`. Help lines ≤120 chars.

Example entries:

```ts
// === Zombies ===
{
  path: "Zombies.Speed",
  label: "Zombie speed",
  section: "Zombies",
  type: "enum",
  options: [
    { value: 1, label: "Sprinters" },
    { value: 2, label: "Fast shamblers" },
    { value: 3, label: "Shamblers" },
    { value: 4, label: "Random (per-zombie)" },
  ],
  default: 4,
  help: "Base zombie movement speed. Random picks per-zombie.",
  requiresRestart: true,
},
{
  path: "Zombies.PopulationMultiplier",
  label: "Population multiplier",
  section: "Zombies",
  type: "float",
  min: 0.0,
  max: 4.0,
  step: 0.05,
  default: 1.0,
  help: "Global population multiplier. 0.35=Low, 1.0=Normal, 2.0=Insane.",
  requiresRestart: true,
},
```

- [ ] **Step 3: Commit**

```bash
git add lib/pz/sandbox-descriptors.ts
git commit -m "feat(pz): full sandbox descriptor coverage for B42 stock vars"
```

---

## Task 2.4 — Coverage test + generator script

**Files:**
- Create: `scripts/gen-servertest-fixture.ts`
- Create: `tests/fixtures/servertest-sandbox.lua` (generated)
- Create: `tests/unit/pz/descriptors.coverage.test.ts`

- [ ] **Step 1: Generator script** — parse `data/pz/ServerSandboxOptions.lua` (B42 reference) and emit a canonical `servertest_SandboxVars.lua` with default values:

```ts
// scripts/gen-servertest-fixture.ts
import { readFile, writeFile } from "node:fs/promises";
// Parse the options file, extract { path, defaultValue } pairs,
// write a SandboxVars = { ... } literal to tests/fixtures/servertest-sandbox.lua.
```

- [ ] **Step 2: Coverage test:**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSandboxLua } from "@/lib/pz/parse-sandbox-lua";
import { describeSandbox, SANDBOX_DESCRIPTORS } from "@/lib/pz/sandbox-descriptors";

describe("sandbox descriptor coverage", () => {
  it("every key in stock fixture has a descriptor", () => {
    const stock = readFileSync("tests/fixtures/servertest-sandbox.lua", "utf8");
    const parsed = parseSandboxLua(stock);
    const missing: string[] = [];
    for (const section of parsed.sections) {
      for (const entry of section.entries) {
        const path = section.name === "_root" ? entry.key : `${section.name}.${entry.key}`;
        if (!describeSandbox(path)) missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });

  it("descriptor type matches parsed value type for stock fixture", () => {
    const stock = readFileSync("tests/fixtures/servertest-sandbox.lua", "utf8");
    const parsed = parseSandboxLua(stock);
    const mismatched: string[] = [];
    for (const section of parsed.sections) {
      for (const entry of section.entries) {
        const path = section.name === "_root" ? entry.key : `${section.name}.${entry.key}`;
        const d = describeSandbox(path);
        if (!d) continue;
        const pt = typeof entry.value;
        const ok =
          (d.type === "bool" && pt === "boolean") ||
          (d.type === "int" && pt === "number") ||
          (d.type === "float" && pt === "number") ||
          (d.type === "enum" && (pt === "number" || pt === "string")) ||
          (d.type === "string" && pt === "string");
        if (!ok) mismatched.push(`${path}: desc=${d.type} parsed=${pt}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("every descriptor is reachable via describeSandbox()", () => {
    for (const d of SANDBOX_DESCRIPTORS) {
      expect(describeSandbox(d.path)).toBe(d);
    }
  });
});
```

- [ ] **Step 3: Run** (`pnpm vitest run tests/unit/pz/descriptors.coverage.test.ts`). Fix any gaps in Task 2.3 until green.

- [ ] **Step 4: Commit**

```bash
git add scripts/gen-servertest-fixture.ts tests/fixtures/servertest-sandbox.lua tests/unit/pz/descriptors.coverage.test.ts
git commit -m "test(pz): sandbox descriptor coverage against stock fixture"
```

---

## Task 2.5 — Chunk 2 acceptance gate

- [ ] `pnpm vitest run tests/unit/pz/descriptors.coverage.test.ts` green.
- [ ] `pnpm vitest run` green overall.
- [ ] No UI changes — config page still renders with old rendering path.
- [ ] Merge to main via PR.
