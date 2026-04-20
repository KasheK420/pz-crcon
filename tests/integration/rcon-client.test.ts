import { afterAll, describe, expect, it } from "vitest";

const integration = process.env.INTEGRATION === "1";
const d = integration ? describe : describe.skip;

d("rcon client (real PZ server)", () => {
  afterAll(async () => {
    const { rconClose } = await import("@/lib/rcon/client");
    await rconClose();
  });

  it("executes players and gets text back", async () => {
    const { rconExecute } = await import("@/lib/rcon/client");
    const out = await rconExecute("players");
    expect(out).toMatch(/Players connected/);
  });

  it("parses the response", async () => {
    const { rconExecute } = await import("@/lib/rcon/client");
    const { parsePlayersOutput } = await import("@/lib/rcon/parsers");
    const out = await rconExecute("players");
    const parsed = parsePlayersOutput(out);
    expect(parsed.count).toBeGreaterThanOrEqual(0);
    expect(parsed.names.length).toBe(parsed.count);
  });
});
