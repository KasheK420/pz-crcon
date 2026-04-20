import { describe, expect, it } from "vitest";

/**
 * Tiny smoke tests for the regexes the log streamer uses to (a) strip
 * ANSI colour codes out of PZ console output before publishing it on
 * `logs:server` and (b) scrape the most recent TPS sample.
 *
 * The full module wires into the WS subscriber-count hook + dockerode
 * so we only pull the regex constants out for unit-level checks.
 */

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const TPS_PATTERN = /TPS[:=\s]+([0-9]+(?:\.[0-9]+)?)/i;

function matchTps(line: string): RegExpExecArray | null {
  return TPS_PATTERN.exec(line);
}

describe("log streamer regex helpers", () => {
  it("strips ANSI colour codes", () => {
    const dirty = "\u001b[31mERROR\u001b[0m: zombie horde \u001b[33mwarning\u001b[0m";
    expect(dirty.replace(ANSI_RE, "")).toBe("ERROR: zombie horde warning");
  });

  it("strips multi-segment SGR codes", () => {
    const dirty = "\u001b[1;33;40mWORLD SAVED\u001b[0m";
    expect(dirty.replace(ANSI_RE, "")).toBe("WORLD SAVED");
  });

  it("extracts TPS from a colon-separated line", () => {
    const m = matchTps("Server tick: TPS: 30.0 ms 33");
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(30);
  });

  it("extracts TPS from an equals-separated line", () => {
    const m = matchTps("[main] TPS=29.7 frame=33ms");
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(29.7);
  });

  it("returns null when no TPS present", () => {
    expect(matchTps("LuaManager initialized")).toBeNull();
  });
});
