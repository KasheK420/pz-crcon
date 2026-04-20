/**
 * Line-based INI rewriter.
 *
 * Preserves every non-matching line verbatim. For lines matching a key
 * listed in `patch`, only the value portion is replaced — surrounding
 * whitespace, the `=` sign's spacing, and any trailing inline comment
 * (`#` or `;`) are left intact.
 *
 * We deliberately avoid a full AST rewrite: PZ's server.ini has no sections
 * that would survive a round-trip through `parseIni` (that parser flattens),
 * and comments / blank lines carry intent the UI should not destroy.
 */

type Scalar = string | number | boolean;

const LINE_PATTERN = /^(\s*)([A-Za-z_][\w]*)(\s*)=(\s*)(.*)$/;

function scalarToString(v: Scalar): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function serializeIni(src: string, patch: Record<string, Scalar>): string {
  if (Object.keys(patch).length === 0) return src;

  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const m = line.match(LINE_PATTERN);
    if (!m) {
      out.push(line);
      continue;
    }
    const [, lead, key, ws1, ws2, tail] = m;
    if (!(key in patch)) {
      out.push(line);
      continue;
    }
    // Detect an inline comment starting with whitespace + # or ;.
    const cmtIdx = tail.search(/\s+#|\s+;/);
    const valueSlice = cmtIdx >= 0 ? tail.slice(0, cmtIdx) : tail;
    const trailer = cmtIdx >= 0 ? tail.slice(cmtIdx) : "";
    const trimmedValue = valueSlice.replace(/\s+$/, "");
    const trailingWs = valueSlice.slice(trimmedValue.length);
    out.push(
      `${lead}${key}${ws1}=${ws2}${scalarToString(patch[key])}${trailingWs}${trailer}`,
    );
  }
  return out.join(eol);
}
