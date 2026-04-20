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
 */

export type SandboxValueKind = "number" | "string" | "boolean" | "raw";

export interface SandboxEntry {
  key: string;
  value: number | string | boolean;
  kind: SandboxValueKind;
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

/** Strip `--`-prefixed Lua line comments. */
function stripComments(src: string): string {
  return src
    .split(/\r?\n/)
    .map((line) => {
      // Don't try to handle `--[[ ... ]]` block comments — the PZ file
      // doesn't use them. Strip from `--` to EOL but preserve `--` inside
      // a string literal (rare, just check for an open quote count).
      const idx = line.indexOf("--");
      if (idx === -1) return line;
      const before = line.slice(0, idx);
      const quotes = (before.match(/"/g) ?? []).length;
      if (quotes % 2 === 1) return line; // inside a string
      return before;
    })
    .join("\n");
}

/** Extract the body (between the outer braces) of `SandboxVars = { ... }`. */
function extractBody(src: string): string {
  // Find the assignment.
  const eq = src.search(/SandboxVars\s*=\s*\{/);
  if (eq < 0) return "";
  const open = src.indexOf("{", eq);
  if (open < 0) return "";
  // Walk braces to find the matching close.
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/**
 * Walk a Lua-table body returning a flat list of (path, scalar) pairs.
 * `path` is dot-joined: ["Population", "PopulationMultiplier"] => "Population.PopulationMultiplier".
 */
function walkTable(body: string, prefix: string[] = []): Array<{ path: string[]; raw: string }> {
  const out: Array<{ path: string[]; raw: string }> = [];
  let i = 0;
  const len = body.length;

  function skipWs() {
    while (i < len && /[\s,]/.test(body[i])) i++;
  }

  while (i < len) {
    skipWs();
    if (i >= len) break;
    // Read key (ident or ["..."]).
    let key = "";
    if (body[i] === "[") {
      const end = body.indexOf("]", i);
      if (end < 0) break;
      key = body
        .slice(i + 1, end)
        .replace(/^["']|["']$/g, "")
        .trim();
      i = end + 1;
    } else {
      const m = /^([A-Za-z_][\w]*)/.exec(body.slice(i));
      if (!m) {
        // Skip unknown char and keep scanning.
        i++;
        continue;
      }
      key = m[1];
      i += m[1].length;
    }
    skipWs();
    if (body[i] !== "=") {
      // Not a kv pair — skip to next comma.
      const next = body.indexOf(",", i);
      if (next < 0) break;
      i = next + 1;
      continue;
    }
    i++; // skip '='
    skipWs();
    if (body[i] === "{") {
      // Nested table: walk to matching brace.
      let depth = 0;
      const open = i;
      for (; i < len; i++) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      const inner = body.slice(open + 1, i - 1);
      const sub = walkTable(inner, [...prefix, key]);
      out.push(...sub);
    } else {
      // Read scalar literal up to comma or close.
      let end = i;
      let inStr: '"' | "'" | null = null;
      while (end < len) {
        const ch = body[end];
        if (inStr) {
          if (ch === "\\") {
            end += 2;
            continue;
          }
          if (ch === inStr) inStr = null;
        } else {
          if (ch === '"' || ch === "'") inStr = ch as '"' | "'";
          else if (ch === "," || ch === "}" || ch === "\n") break;
        }
        end++;
      }
      const raw = body.slice(i, end).trim();
      if (raw.length > 0) {
        out.push({ path: [...prefix, key], raw });
      }
      i = end;
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
  const cleaned = stripComments(src);
  const body = extractBody(cleaned);
  if (!body.trim()) return { sections: [], flat: {} };

  const pairs = walkTable(body);
  const sectionsMap = new Map<string, SandboxEntry[]>();
  const flat: Record<string, number | string | boolean> = {};

  for (const { path, raw } of pairs) {
    const sectionName = path.length === 1 ? "_root" : path.slice(0, -1).join(".");
    const key = path[path.length - 1];
    const classified = classify(raw);
    let value: number | string | boolean;
    let kind: SandboxValueKind;
    if (classified === undefined) {
      value = raw;
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
    sectionsMap.get(sectionName)!.push({ key, value, kind });
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
