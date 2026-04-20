import { describe, expect, it } from "vitest";
import { parsePlayersOutput, parseRconLine } from "@/lib/rcon/parsers";

describe("parsePlayersOutput", () => {
  it("parses empty list", () => {
    const out = "Players connected (0):";
    expect(parsePlayersOutput(out)).toEqual({ count: 0, names: [] });
  });

  it("parses 3 players", () => {
    const out = "Players connected (3):\n-Honza\n-Petr\n-Standa";
    expect(parsePlayersOutput(out)).toEqual({
      count: 3,
      names: ["Honza", "Petr", "Standa"],
    });
  });

  it("trims whitespace", () => {
    const out = "Players connected (1):\r\n  -Kaja  \r\n";
    expect(parsePlayersOutput(out)).toEqual({ count: 1, names: ["Kaja"] });
  });

  it("throws on unrecognized header", () => {
    expect(() => parsePlayersOutput("???")).toThrow(/players header/i);
  });

  it("count mismatch throws", () => {
    const out = "Players connected (5):\n-Honza";
    expect(() => parsePlayersOutput(out)).toThrow(/count/i);
  });
});

describe("parseRconLine", () => {
  it("classifies info", () => {
    expect(parseRconLine("World saved.").kind).toBe("ok");
  });
  it("classifies error", () => {
    expect(parseRconLine("ERROR: bad command").kind).toBe("error");
  });
  it("classifies warn", () => {
    expect(parseRconLine("WARN: deprecated").kind).toBe("warn");
  });
});
