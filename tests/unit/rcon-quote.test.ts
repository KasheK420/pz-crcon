import { describe, expect, it } from "vitest";
import { quoteArg, buildCommand } from "@/lib/rcon/quote";

describe("quoteArg", () => {
  it("wraps simple values in double quotes", () => {
    expect(quoteArg("Honza")).toBe('"Honza"');
  });

  it("preserves spaces inside the quoted value", () => {
    expect(quoteArg("Honza Novak")).toBe('"Honza Novak"');
  });

  it("strips embedded double quotes (no RCON escape syntax)", () => {
    expect(quoteArg('he said "hi"')).toBe('"he said hi"');
  });

  it("collapses CR/LF that would corrupt the wire protocol", () => {
    expect(quoteArg("line1\nline2\r\nline3")).toBe('"line1line2line3"');
  });

  it("trims surrounding whitespace", () => {
    expect(quoteArg("   spaced   ")).toBe('"spaced"');
  });
});

describe("buildCommand", () => {
  it("joins head + quoted args with spaces", () => {
    expect(buildCommand("kick", ["Honza", "AFK"])).toBe('kick "Honza" "AFK"');
  });

  it("works with no args", () => {
    expect(buildCommand("save", [])).toBe("save");
  });

  it("survives names with embedded quotes (sanitised)", () => {
    expect(buildCommand("ban", ['evil"name', "griefing"])).toBe(
      'ban "evilname" "griefing"'
    );
  });
});
