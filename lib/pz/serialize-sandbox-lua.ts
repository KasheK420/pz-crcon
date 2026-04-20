/**
 * Offset-based rewriter for `<prefix>_SandboxVars.lua`.
 *
 * Strategy: parse once to obtain per-entry `valueStart`/`valueEnd` offsets,
 * build a path→offsets map, sort edits by descending `valueStart`, then
 * splice replacements end-to-start so earlier offsets stay valid.
 *
 * Unknown paths throw `unknown-key` (the writer catches and maps this to a
 * typed failure code). Paths are dot-joined: top-level entries use bare
 * names (e.g. `VERSION`); nested entries include the section (e.g.
 * `Zombies.Speed`, `Population.PopulationMultiplier`).
 *
 * Only scalar values are supported. Attempting to patch a key whose source
 * form is a table is currently rejected upstream by the descriptor check
 * before serialize is called; if it somehow reaches us we still replace
 * the single-token slice, which produces deterministic (if wrong) output —
 * the writer validates shape in advance.
 */
import { parseSandboxLua } from "./parse-sandbox-lua";

type Scalar = number | string | boolean;

function scalarLiteral(v: Scalar): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export class UnknownSandboxKeyError extends Error {
  readonly code = "unknown-key" as const;
  constructor(public readonly path: string) {
    super(`unknown-key: ${path}`);
    this.name = "UnknownSandboxKeyError";
  }
}

export function serializeSandboxLua(
  src: string,
  patch: Record<string, Scalar>,
): string {
  const keys = Object.keys(patch);
  if (keys.length === 0) return src;

  const parsed = parseSandboxLua(src);
  const offsetByPath = new Map<string, { valueStart: number; valueEnd: number }>();
  for (const section of parsed.sections) {
    for (const entry of section.entries) {
      const path = section.name === "_root" ? entry.key : `${section.name}.${entry.key}`;
      offsetByPath.set(path, { valueStart: entry.valueStart, valueEnd: entry.valueEnd });
    }
  }

  // Validate every target path before mutating anything.
  for (const k of keys) {
    if (!offsetByPath.has(k)) {
      throw new UnknownSandboxKeyError(k);
    }
  }

  const edits = keys
    .map((k) => ({ path: k, ...offsetByPath.get(k)!, value: patch[k] }))
    .sort((a, b) => b.valueStart - a.valueStart);

  let out = src;
  for (const e of edits) {
    out = out.slice(0, e.valueStart) + scalarLiteral(e.value) + out.slice(e.valueEnd);
  }
  return out;
}
