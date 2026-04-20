/**
 * Parses `tests/fixtures/live-sandbox.lua` (a dump of `MajorlukPZ_SandboxVars.lua`
 * produced by a running PZ B42 server) and emits a TypeScript file that seeds
 * `SANDBOX_DESCRIPTORS`. The Lua file the devs ship has inline comments that
 * document defaults, enum options, and numeric ranges:
 *
 *   -- How fast zombies move. Default = Random
 *   -- 1 = Sprinters
 *   -- 2 = Fast Shamblers
 *   -- 3 = Shamblers
 *   -- 4 = Random
 *   Speed = 4,
 *
 * We walk the file line-by-line tracking the current section (nested table),
 * buffer the comment block preceding each `Key = value,` line, and infer
 * a descriptor from the comment block + the current value.
 *
 * The output is *reviewed and hand-tweaked* — keep this script around so we
 * can regenerate when PZ ships a new comment block. It intentionally does
 * not overwrite `lib/pz/sandbox-descriptors.ts`; it writes to stdout by
 * default or to `--out <path>`.
 *
 * Usage:
 *   pnpm tsx scripts/build-sandbox-descriptors.ts \
 *     --in tests/fixtures/live-sandbox.lua \
 *     --out lib/pz/sandbox-descriptors.generated.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface EnumOption {
  value: number;
  label: string;
}

interface RawDescriptor {
  path: string;
  section: string;
  subsection?: string;
  key: string;
  rawValue: string;
  type: "bool" | "int" | "float" | "enum" | "string";
  default: boolean | number | string;
  min?: number;
  max?: number;
  options?: EnumOption[];
  help: string;
  /** The raw comment block (including "Default = ..." and enum lines). */
  comments: string[];
}

/** Parse "Min: X Max: Y Default: Z" fragments out of a help line. */
function parseRanges(line: string): { min?: number; max?: number; default?: number } {
  const out: { min?: number; max?: number; default?: number } = {};
  const min = /Min:\s*(-?\d+(?:\.\d+)?)/.exec(line);
  const max = /Max:\s*(-?\d+(?:\.\d+)?)/.exec(line);
  const def = /Default:\s*(-?\d+(?:\.\d+)?)/.exec(line);
  if (min) out.min = Number(min[1]);
  if (max) out.max = Number(max[1]);
  if (def) out.default = Number(def[1]);
  return out;
}

function classifyScalar(raw: string): boolean | number | string | undefined {
  const trimmed = raw.trim().replace(/,$/, "").trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^".*"$/.test(trimmed)) return trimmed.slice(1, -1);
  if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1);
  return undefined;
}

/** Extract "N = Label" enum option lines from the comment block. */
function parseEnumOptions(comments: string[]): EnumOption[] {
  const opts: EnumOption[] = [];
  for (const c of comments) {
    // Match "N = Label" where N is a positive integer.
    const m = /^\s*(\d+)\s*=\s*(.+?)\s*$/.exec(c);
    if (m) {
      opts.push({ value: Number(m[1]), label: m[2] });
    }
  }
  return opts;
}

/** Extract a human help sentence by filtering out enum / range meta lines. */
function buildHelp(comments: string[]): string {
  const cleaned = comments
    .filter((c) => !/^\s*\d+\s*=/.test(c)) // drop "1 = Foo"
    .map((c) => c.replace(/Min:\s*-?\d+(?:\.\d+)?\s*/g, "").trim())
    .map((c) => c.replace(/Max:\s*-?\d+(?:\.\d+)?\s*/g, "").trim())
    .map((c) => c.replace(/Default\s*[:=]\s*.+$/i, "").trim())
    .map((c) => c.replace(/<BHC>.*?<RGB:[^>]+>\s*/g, "").trim())
    .filter((c) => c.length > 0);
  const joined = cleaned.join(" ").replace(/\s+/g, " ").trim();
  return joined;
}

/** Parse the "Default = X" sentinel from comments; return the matching enum value or raw label. */
function parseEnumDefault(
  comments: string[],
  options: EnumOption[],
): number | undefined {
  for (const c of comments) {
    const m = /Default\s*=\s*(.+?)\s*$/.exec(c);
    if (!m) continue;
    const label = m[1].trim();
    const hit = options.find((o) => o.label === label);
    if (hit) return hit.value;
    // Sometimes the label has trailing punctuation or slight variance; try fuzzy.
    const fuzzy = options.find(
      (o) => o.label.toLowerCase() === label.toLowerCase(),
    );
    if (fuzzy) return fuzzy.value;
  }
  return undefined;
}

function main() {
  const args = process.argv.slice(2);
  let inPath = "tests/fixtures/live-sandbox.lua";
  let outPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--in") inPath = args[++i];
    else if (args[i] === "--out") outPath = args[++i];
  }

  const src = readFileSync(resolve(inPath), "utf8");
  const lines = src.split(/\r?\n/);

  const descriptors: RawDescriptor[] = [];
  const sectionStack: string[] = []; // e.g. ["ZombieLore"]
  let commentBuf: string[] = [];

  const ENTRY_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?),?\s*$/;
  const TABLE_OPEN_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{\s*$/;
  const TABLE_CLOSE_RE = /^\s*\}\s*,?\s*$/;
  const COMMENT_RE = /^\s*--\s?(.*)$/;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // Opening line of the outer SandboxVars = { is skipped (treated as root).
    if (/^\s*SandboxVars\s*=\s*\{\s*$/.test(line)) {
      commentBuf = [];
      continue;
    }

    const c = COMMENT_RE.exec(line);
    if (c) {
      commentBuf.push(c[1]);
      continue;
    }

    const tOpen = TABLE_OPEN_RE.exec(line);
    if (tOpen) {
      sectionStack.push(tOpen[1]);
      commentBuf = [];
      continue;
    }

    if (TABLE_CLOSE_RE.test(line)) {
      // If we're closing the outermost SandboxVars, stack is empty already.
      if (sectionStack.length > 0) sectionStack.pop();
      commentBuf = [];
      continue;
    }

    const m = ENTRY_RE.exec(line);
    if (!m) {
      if (line.trim().length === 0) commentBuf = [];
      continue;
    }

    const key = m[1];
    const rawValue = m[2];
    const section = sectionStack.length === 0 ? "_root" : sectionStack[0];
    const subsection = sectionStack.length > 1 ? sectionStack.slice(1).join(".") : undefined;

    const value = classifyScalar(rawValue);
    if (value === undefined) {
      commentBuf = [];
      continue;
    }

    const options = parseEnumOptions(commentBuf);
    let type: RawDescriptor["type"];
    let dflt: boolean | number | string = value;
    let min: number | undefined;
    let max: number | undefined;

    if (typeof value === "boolean") {
      type = "bool";
      const boolDefault = commentBuf
        .map((cmt) => /Default\s*=\s*(true|false)/i.exec(cmt))
        .find((mm) => mm !== null);
      if (boolDefault) dflt = boolDefault[1].toLowerCase() === "true";
    } else if (typeof value === "string") {
      type = "string";
    } else if (options.length >= 2 && Number.isInteger(value)) {
      type = "enum";
      const enumDefault = parseEnumDefault(commentBuf, options);
      if (enumDefault !== undefined) dflt = enumDefault;
    } else {
      const hasDot = /\./.test(rawValue);
      type = hasDot ? "float" : "int";
      for (const cmt of commentBuf) {
        const r = parseRanges(cmt);
        if (r.min !== undefined) min = r.min;
        if (r.max !== undefined) max = r.max;
        if (r.default !== undefined) dflt = r.default;
      }
    }

    const path =
      section === "_root"
        ? key
        : subsection
          ? `${section}.${subsection}.${key}`
          : `${section}.${key}`;

    const help = buildHelp(commentBuf) || `(no help available for ${path})`;

    descriptors.push({
      path,
      section: section === "_root" ? "General" : section,
      subsection,
      key,
      rawValue,
      type,
      default: dflt,
      min,
      max,
      options: options.length ? options : undefined,
      help,
      comments: commentBuf.slice(),
    });

    commentBuf = [];
  }

  const header = `/**
 * AUTO-GENERATED by scripts/build-sandbox-descriptors.ts from tests/fixtures/live-sandbox.lua.
 * Hand-edit after regeneration to fix any gaps flagged with "TODO: verify".
 * Re-run after a PZ update with:  pnpm tsx scripts/build-sandbox-descriptors.ts --out lib/pz/sandbox-descriptors.generated.ts
 */

export type SandboxValueType = "bool" | "int" | "float" | "enum" | "string";

export interface SandboxDescriptor {
  /** Dot-path matching \`parseSandboxLua()\` flat keys (e.g. \"ZombieLore.Speed\"; top-level keys have no section prefix). */
  path: string;
  label: string;
  section: string;
  subsection?: string;
  type: SandboxValueType;
  default: boolean | number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: number | string; label: string; help?: string }>;
  help: string;
  /** All sandbox keys require a server restart to take effect today. */
  requiresRestart: boolean;
}
`;

  const records = descriptors.map((d) => {
    // Split camelCase: "ZombieLore" -> "Zombie Lore", "PVP" -> "PVP", "VERSION" -> "VERSION".
    const label = d.key
      // Split between lowercase-or-digit and uppercase: "fooBar" -> "foo Bar"
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      // Split between an all-caps run and a following capitalized word: "XMLParser" -> "XML Parser"
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .trim();
    const parts: string[] = [];
    parts.push(`    path: ${JSON.stringify(d.path)},`);
    parts.push(`    label: ${JSON.stringify(label)},`);
    parts.push(`    section: ${JSON.stringify(d.section)},`);
    if (d.subsection) parts.push(`    subsection: ${JSON.stringify(d.subsection)},`);
    parts.push(`    type: ${JSON.stringify(d.type)},`);
    parts.push(`    default: ${JSON.stringify(d.default)},`);
    if (d.min !== undefined) parts.push(`    min: ${d.min},`);
    if (d.max !== undefined) parts.push(`    max: ${d.max},`);
    if (d.options) {
      const opts = d.options
        .map(
          (o) =>
            `      { value: ${o.value}, label: ${JSON.stringify(o.label)} }`,
        )
        .join(",\n");
      parts.push(`    options: [\n${opts},\n    ],`);
    }
    parts.push(`    help: ${JSON.stringify(d.help)},`);
    parts.push(`    requiresRestart: true,`);
    return `  {\n${parts.join("\n")}\n  },`;
  });

  const body = `export const SANDBOX_DESCRIPTORS: SandboxDescriptor[] = [
${records.join("\n")}
];

const BY_PATH = new Map<string, SandboxDescriptor>(
  SANDBOX_DESCRIPTORS.map((d) => [d.path, d]),
);

export function describeSandbox(path: string): SandboxDescriptor | undefined {
  return BY_PATH.get(path);
}

export const SANDBOX_SECTIONS: Array<{ key: string; label: string; order: number }> = [
  { key: "General", label: "General", order: 1 },
  { key: "Basement", label: "Basement", order: 2 },
  { key: "Map", label: "Map", order: 3 },
  { key: "ZombieLore", label: "Zombie lore", order: 4 },
  { key: "ZombieConfig", label: "Zombie config", order: 5 },
  { key: "MultiplierConfig", label: "Skill multipliers", order: 6 },
];
`;

  const output = `${header}\n${body}`;

  if (outPath) {
    writeFileSync(resolve(outPath), output, "utf8");
    process.stderr.write(`wrote ${descriptors.length} descriptors to ${outPath}\n`);
  } else {
    process.stdout.write(output);
    process.stderr.write(`emitted ${descriptors.length} descriptors to stdout\n`);
  }
}

main();
