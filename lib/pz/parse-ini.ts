/**
 * Parse the PZ `servertest.ini` file. The format is intentionally simple:
 *
 *   # comment
 *   Key=Value
 *   AnotherKey=value with spaces
 *   ListKey=a,b,c
 *
 * There are no sections / no quoting. We strip `#`-leading comments and
 * trim whitespace. Blank lines are skipped. Duplicate keys: last wins.
 */

export interface IniEntry {
  key: string;
  value: string;
  /** 1-indexed line number from the source file (for surfacing errors). */
  line: number;
}

export interface ParsedIni {
  entries: IniEntry[];
  /** Convenience map (last-wins) from key to value. */
  map: Record<string, string>;
}

export function parseIni(source: string): ParsedIni {
  const entries: IniEntry[] = [];
  const map: Record<string, string> = {};
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    entries.push({ key, value, line: i + 1 });
    map[key] = value;
  }
  return { entries, map };
}
