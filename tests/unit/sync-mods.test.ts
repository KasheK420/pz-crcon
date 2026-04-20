import { describe, expect, it } from "vitest";

/**
 * Mirrors the URL/body shape that scripts/sync-mods.ts builds when
 * calling Steam's GetPublishedFileDetails endpoint. The script itself
 * imports prisma + does network IO, so we keep this at the contract
 * level: feed the same IDs through the body builder, check shape.
 */

function buildBody(ids: string[]): URLSearchParams {
  const body = new URLSearchParams();
  body.set("itemcount", String(ids.length));
  ids.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));
  return body;
}

describe("sync-mods Steam request body", () => {
  it("encodes itemcount and indexed ids", () => {
    const body = buildBody(["111", "222", "333"]);
    expect(body.get("itemcount")).toBe("3");
    expect(body.get("publishedfileids[0]")).toBe("111");
    expect(body.get("publishedfileids[1]")).toBe("222");
    expect(body.get("publishedfileids[2]")).toBe("333");
  });

  it("handles empty list (header-only)", () => {
    const body = buildBody([]);
    expect(body.get("itemcount")).toBe("0");
    expect(body.toString()).toBe("itemcount=0");
  });
});
