export interface PlayersList {
  count: number;
  names: string[];
}

const HEADER_RE = /^Players connected \((\d+)\):\s*$/;

export function parsePlayersOutput(raw: string): PlayersList {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw new Error("Empty players output");
  }
  const headerMatch = HEADER_RE.exec(lines[0]);
  if (!headerMatch) {
    throw new Error(`Unrecognized players header: ${lines[0]}`);
  }
  const count = Number(headerMatch[1]);
  const names = lines
    .slice(1)
    .filter((l) => l.startsWith("-"))
    .map((l) => l.replace(/^-/, "").trim())
    .filter(Boolean);
  if (names.length !== count) {
    throw new Error(
      `Players count mismatch: header=${count}, parsed=${names.length}`
    );
  }
  return { count, names };
}

export type LineKind = "info" | "warn" | "error" | "ok";

export interface ClassifiedLine {
  kind: LineKind;
  text: string;
}

export function parseRconLine(line: string): ClassifiedLine {
  if (/^ERROR\b/i.test(line)) return { kind: "error", text: line };
  if (/^WARN\b/i.test(line)) return { kind: "warn", text: line };
  if (/^OK\b|saved\.|complete\.|started\./i.test(line)) {
    return { kind: "ok", text: line };
  }
  return { kind: "info", text: line };
}
