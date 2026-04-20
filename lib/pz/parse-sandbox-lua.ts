/**
 * Regex-based parser for the PZ sandbox vars file:
 *
 *   SandboxVars = {
 *       VERSION = 5,
 *       Population = {
 *           PopulationMultiplier = 1.4,
 *           PopulationStartMultiplier = 1.0,
 *       },
 *       ...
 *   }
 *
 * We don't write a real Lua interpreter — the file shape is predictable
 * and the values we care about are scalar. Anything we can't classify as
 * number / string / boolean is captured as a raw string value and tagged
 * `kind: "raw"` so the UI can display it without misrepresenting it.
 *
 * Behaviour:
 *  - Top-level scalars (e.g. `VERSION = 5`) become entries in the synthetic
 *    section "_root".
 *  - Nested tables become a section, keyed by the table name.
 *  - Nested-nested tables are flattened into "Section.SubSection" keys to
 *    keep the UI a flat 2-level grid; rare in practice.
 *  - Each entry carries `valueStart`/`valueEnd` byte offsets pointing back
 *    into the *original* source string. The range covers only the raw value
 *    literal (not the `key = ` part, not the trailing comma). The serializer
 *    uses these offsets to splice new values in without disturbing comments
 *    or whitespace.
 */

export type SandboxValueKind = "number" | "string" | "boolean" | "raw";

export interface SandboxEntry {
  key: string;
  value: number | string | boolean;
  kind: SandboxValueKind;
  /** Byte offset (into the original source string) where the raw value literal starts. */
  valueStart: number;
  /** Byte offset (exclusive) where the raw value literal ends. */
  valueEnd: number;
}

export interface SandboxSection {
  name: string;
  entries: SandboxEntry[];
}

export interface ParsedSandbox {
  sections: SandboxSection[];
  /** All entries flattened: `Section.Key` => value. */
  flat: Record<string, number | string | boolean>;
}

const DOUBLE_QUOTE = '"';
const SINGLE_QUOTE = "'";
const STRING_DOUBLE = new RegExp(`^${DOUBLE_QUOTE}[^${DOUBLE_QUOTE}]*${DOUBLE_QUOTE}$`);
const STRING_SINGLE = new RegExp(`^${SINGLE_QUOTE}[^${SINGLE_QUOTE}]*${SINGLE_QUOTE}$`);

/**
 * Mask Lua `--`-prefixed line comments with spaces so byte offsets stay
 * aligned with the original source. Newlines are preserved so the regex
 * scanning still sees line structure.
 */
function maskComments(src: string): string {
  // Split but keep separators so offsets align when we rejoin.
  const parts = src.split(/(\r?\n)/);
  const out: string[] = [];
  for (const chunk of parts) {
    if (chunk === "\r\n" || chunk === "\n") {
      out.push(chunk);
      continue;
    }
    const idx = chunk.indexOf("--");
    if (idx === -1) {
      out.push(chunk);
      continue;
    }
    const before = chunk.slice(0, idx);
    const quotes = (before.match(/"/g) ?? []).length;
    if (quotes % 2 === 1) {
      out.push(chunk); // inside a string — don't mask
      continue;
    }
    // Replace the comment portion with spaces of equal length (preserve offsets).
    out.push(before + " ".repeat(chunk.length - before.length));
  }
  return out.join("");
}

/** Locate the outer body: returns [start, end) offsets in the source. */
function locateBody(src: string): { start: number; end: number } | null {
  const eq = src.search(/SandboxVars\s*=\s*\{/);
  if (eq < 0) return null;
  const open = src.indexOf("{", eq);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { start: open + 1, end: i };
    }
  }
  return { start: open + 1, end: src.length };
}

/**
 * Walk a Lua-table body returning a flat list of (path, raw, offsets).
 * `src` is the whole comment-masked source; `start` and `end` bound the
 * current table body within it. All offsets are absolute into `src` (which
 * is the same-length as the original source, so offsets map straight through).
 */
function walkTable(
  src: string,
  start: number,
  end: number,
  prefix: string[] = [],
): Array<{ path: string[]; raw: string; valueStart: number; valueEnd: number }> {
  const out: Array<{ path: string[]; raw: string; valueStart: number; valueEnd: number }> = [];
  let i = start;

  function skipWs() {
    while (i < end && /[\s,]/.test(src[i])) i++;
  }

  while (i < end) {
    skipWs();
    if (i >= end) break;
    // Read key (ident or ["..."]).
    let key = "";
    if (src[i] === "[") {
      const closeIdx = src.indexOf("]", i);
      if (closeIdx < 0 || closeIdx >= end) break;
      key = src
        .slice(i + 1, closeIdx)
        .replace(/^["']|["']$/g, "")
        .trim();
      i = closeIdx + 1;
    } else {
      const m = /^([A-Za-z_][\w]*)/.exec(src.slice(i, end));
      if (!m) {
        i++;
        continue;
      }
      key = m[1];
      i += m[1].length;
    }
    skipWs();
    if (src[i] !== "=") {
      // Not a kv pair — skip to next comma.
      const next = src.indexOf(",", i);
      if (next < 0 || next >= end) break;
      i = next + 1;
      continue;
    }
    i++; // skip '='
    skipWs();
    if (src[i] === "{") {
      // Nested table: walk to matching brace.
      let depth = 0;
      const open = i;
      for (; i < end; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      const innerStart = open + 1;
      const innerEnd = i - 1; // index of the matching '}'
      const sub = walkTable(src, innerStart, innerEnd, [...prefix, key]);
      out.push(...sub);
    } else {
      // Read scalar literal up to comma, close brace, or newline.
      const valueStart = i;
      let j = i;
      let inStr: '"' | "'" | null = null;
      while (j < end) {
        const ch = src[j];
        if (inStr) {
          if (ch === "\\") {
            j += 2;
            continue;
          }
          if (ch === inStr) inStr = null;
        } else {
          if (ch === '"' || ch === "'") inStr = ch as '"' | "'";
          else if (ch === "," || ch === "}" || ch === "\n") break;
        }
        j++;
      }
      // Trim trailing whitespace off the literal so offsets point at the
      // literal itself, not the whitespace before the comma.
      let literalEnd = j;
      while (literalEnd > valueStart && /\s/.test(src[literalEnd - 1])) literalEnd--;
      const raw = src.slice(valueStart, literalEnd);
      if (raw.length > 0) {
        out.push({ path: [...prefix, key], raw, valueStart, valueEnd: literalEnd });
      }
      i = j;
    }
    skipWs();
  }
  return out;
}

function classify(raw: string): SandboxEntry["value"] | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (STRING_DOUBLE.test(raw) || STRING_SINGLE.test(raw)) return raw.slice(1, -1);
  return undefined;
}

export function parseSandboxLua(src: string): ParsedSandbox {
  const masked = maskComments(src);
  const body = locateBody(masked);
  if (!body) return { sections: [], flat: {} };

  const pairs = walkTable(masked, body.start, body.end);
  const sectionsMap = new Map<string, SandboxEntry[]>();
  const flat: Record<string, number | string | boolean> = {};

  for (const p of pairs) {
    const sectionName = p.path.length === 1 ? "_root" : p.path.slice(0, -1).join(".");
    const key = p.path[p.path.length - 1];
    // Slice from original src: offsets are same because comment masking
    // only replaced chars with spaces (length-preserving).
    const rawOriginal = src.slice(p.valueStart, p.valueEnd);
    const classified = classify(rawOriginal);
    let value: number | string | boolean;
    let kind: SandboxValueKind;
    if (classified === undefined) {
      value = rawOriginal;
      kind = "raw";
    } else if (typeof classified === "boolean") {
      value = classified;
      kind = "boolean";
    } else if (typeof classified === "number") {
      value = classified;
      kind = "number";
    } else {
      value = classified;
      kind = "string";
    }
    if (!sectionsMap.has(sectionName)) sectionsMap.set(sectionName, []);
    sectionsMap.get(sectionName)!.push({
      key,
      value,
      kind,
      valueStart: p.valueStart,
      valueEnd: p.valueEnd,
    });
    flat[`${sectionName === "_root" ? "" : sectionName + "."}${key}`] = value;
  }

  const sections: SandboxSection[] = Array.from(sectionsMap.entries()).map(([name, entries]) => ({
    name,
    entries,
  }));
  // Sort: _root first, then alphabetical.
  sections.sort((a, b) => {
    if (a.name === "_root") return -1;
    if (b.name === "_root") return 1;
    return a.name.localeCompare(b.name);
  });

  return { sections, flat };
}
