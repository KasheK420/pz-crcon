import { describe, expect, it } from "vitest";
import { parseIni } from "@/lib/pz/parse-ini";

describe("parseIni", () => {
  it("parses simple key=value lines", () => {
    const src = `
PublicName=Survival Test
PublicDescription=Welcome
MaxPlayers=32
PVP=true
`;
    const r = parseIni(src);
    expect(r.map.PublicName).toBe("Survival Test");
    expect(r.map.MaxPlayers).toBe("32");
    expect(r.map.PVP).toBe("true");
    expect(r.entries).toHaveLength(4);
  });

  it("ignores blank lines and comments", () => {
    const src = `
# header
; semicolon comment too
Key1=v1

  Key2=v2
`;
    const r = parseIni(src);
    expect(r.entries.map((e) => e.key)).toEqual(["Key1", "Key2"]);
  });

  it("preserves spaces and commas inside values", () => {
    const src = `Mods=Mod.A,Mod.B,Mod.C\nDescription=Hello world`;
    const r = parseIni(src);
    expect(r.map.Mods).toBe("Mod.A,Mod.B,Mod.C");
    expect(r.map.Description).toBe("Hello world");
  });

  it("last duplicate wins", () => {
    const src = `K=1\nK=2\nK=3`;
    const r = parseIni(src);
    expect(r.map.K).toBe("3");
    expect(r.entries).toHaveLength(3);
  });

  it("tracks 1-indexed line numbers", () => {
    const src = `# header\nK1=v\n\nK2=w`;
    const r = parseIni(src);
    expect(r.entries[0].line).toBe(2);
    expect(r.entries[1].line).toBe(4);
  });

  it("returns empty for empty input", () => {
    expect(parseIni("")).toEqual({ entries: [], map: {} });
  });
});
