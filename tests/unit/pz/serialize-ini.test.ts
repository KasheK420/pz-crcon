import { describe, it, expect } from "vitest";
import { serializeIni } from "@/lib/pz/serialize-ini";

describe("serializeIni", () => {
  it("returns source unchanged for empty patch", () => {
    const src = "Open=true\nMaxPlayers=16\n";
    expect(serializeIni(src, {})).toBe(src);
  });

  it("replaces matched key value line-by-line", () => {
    const src = "Open=false\nMaxPlayers=16\n";
    const out = serializeIni(src, { Open: true });
    expect(out).toBe("Open=true\nMaxPlayers=16\n");
  });

  it("preserves surrounding whitespace around = sign", () => {
    const src = "  Open =   false   \nMaxPlayers=16\n";
    const out = serializeIni(src, { Open: true });
    expect(out).toBe("  Open =   true   \nMaxPlayers=16\n");
  });

  it("leaves unknown keys untouched (patch key not in source → no-op)", () => {
    const src = "Open=false\n";
    const out = serializeIni(src, { Nope: "x" });
    expect(out).toBe(src);
  });

  it("leaves non-key lines verbatim (section headers, comments, blanks)", () => {
    const src = "[General]\n# a comment\n\nOpen=false\n";
    const out = serializeIni(src, { Open: true });
    expect(out).toBe("[General]\n# a comment\n\nOpen=true\n");
  });

  it("preserves CRLF line endings when source uses them", () => {
    const src = "Open=false\r\nMaxPlayers=16\r\n";
    const out = serializeIni(src, { Open: true });
    expect(out).toBe("Open=true\r\nMaxPlayers=16\r\n");
  });

  it("preserves trailing # comment on same line", () => {
    const src = "Open=false  # default\n";
    const out = serializeIni(src, { Open: true });
    expect(out).toBe("Open=true  # default\n");
  });

  it("preserves trailing ; comment on same line", () => {
    const src = "Open=false ; note\n";
    const out = serializeIni(src, { Open: true });
    expect(out).toBe("Open=true ; note\n");
  });

  it("formats numbers without quoting", () => {
    const src = "MaxPlayers=16\n";
    const out = serializeIni(src, { MaxPlayers: 32 });
    expect(out).toBe("MaxPlayers=32\n");
  });

  it("applies multiple edits in one pass", () => {
    const src = "Open=false\nPVP=true\nMaxPlayers=16\n";
    const out = serializeIni(src, { Open: true, PVP: false, MaxPlayers: 8 });
    expect(out).toBe("Open=true\nPVP=false\nMaxPlayers=8\n");
  });

  it("skips keys present multiple times? matches every occurrence (line-based)", () => {
    // Edge case: duplicate keys — rewriter updates every occurrence.
    const src = "X=1\nX=2\n";
    const out = serializeIni(src, { X: 9 });
    expect(out).toBe("X=9\nX=9\n");
  });
});
