/**
 * Smoke test for the `tecnativa/docker-socket-proxy` endpoint matrix.
 *
 * The lifecycle orchestrator only works if the proxy allows *exactly* the
 * HTTP endpoints we need and denies everything else. This test confirms
 * that contract against a real proxy instance standing alongside Docker.
 *
 * Skipped unless `DOCKER_IN_DOCKER=1` is set so the CI job can spin one
 * up; locally we rely on the unit tests with mocks.
 *
 * Expected proxy env:
 *   CONTAINERS=1
 *   CONTAINERS_START=1 CONTAINERS_STOP=1 CONTAINERS_RESTART=1 CONTAINERS_KILL=1
 *   POST=1
 * Everything else defaults off → denied endpoints return 403.
 */

import { describe, it, expect } from "vitest";

const PROXY_URL = process.env.DOCKER_PROXY_TEST_URL ?? "http://localhost:2375";
const enabled = process.env.DOCKER_IN_DOCKER === "1";
const skip = enabled ? undefined : "DOCKER_IN_DOCKER not set — skipping";

// `itif` is a tiny helper so the test file still registers cleanly when
// the smoke harness is not configured. All cases then show as "skipped".
const itif = enabled ? it : it.skip;

// When running under the CI smoke harness we create a sacrificial
// container that we can legitimately start/stop/kill without side-effects.
const TEST_CONTAINER_IMAGE = "alpine:3.19";
let testContainerId: string | null = null;

async function createTestContainer(): Promise<string> {
  const r = await fetch(`${PROXY_URL}/containers/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      Image: TEST_CONTAINER_IMAGE,
      Cmd: ["sleep", "60"],
      HostConfig: { AutoRemove: true },
    }),
  });
  const j = (await r.json()) as { Id?: string };
  if (!j.Id) throw new Error(`container create failed: ${r.status}`);
  return j.Id;
}

if (enabled) {
  // Top-level await is fine in Vitest ESM; bail fast on setup failure
  // so tests report a clear error instead of 404s against an undefined id.
  testContainerId = await createTestContainer().catch((e) => {
    console.warn("docker-proxy smoke: failed to create test container", e);
    return null;
  });
}

describe("docker-socket-proxy endpoint matrix", { skip }, () => {
  itif("GET /_ping is allowed", async () => {
    const r = await fetch(`${PROXY_URL}/_ping`);
    expect(r.status).toBe(200);
  });

  itif("GET /containers/json is allowed (CONTAINERS=1)", async () => {
    const r = await fetch(`${PROXY_URL}/containers/json?all=1`);
    expect(r.status).toBe(200);
  });

  itif("GET /containers/<id>/json is allowed (inspect)", async () => {
    if (!testContainerId) throw new Error("no test container");
    const r = await fetch(`${PROXY_URL}/containers/${testContainerId}/json`);
    expect(r.status).toBe(200);
  });

  itif("POST /containers/<id>/start is allowed (CONTAINERS_START=1)", async () => {
    if (!testContainerId) throw new Error("no test container");
    const r = await fetch(
      `${PROXY_URL}/containers/${testContainerId}/start`,
      { method: "POST" },
    );
    // 204 on success, 304 if already running — both acceptable.
    expect([204, 304]).toContain(r.status);
  });

  itif("POST /containers/<id>/stop is allowed (CONTAINERS_STOP=1)", async () => {
    if (!testContainerId) throw new Error("no test container");
    const r = await fetch(
      `${PROXY_URL}/containers/${testContainerId}/stop?t=1`,
      { method: "POST" },
    );
    expect([204, 304]).toContain(r.status);
  });

  itif("POST /containers/<id>/exec is DENIED (EXEC=0)", async () => {
    if (!testContainerId) throw new Error("no test container");
    const r = await fetch(
      `${PROXY_URL}/containers/${testContainerId}/exec`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ Cmd: ["true"] }),
      },
    );
    expect(r.status).toBe(403);
  });

  itif("GET /volumes is DENIED (VOLUMES=0)", async () => {
    const r = await fetch(`${PROXY_URL}/volumes`);
    expect(r.status).toBe(403);
  });

  itif("GET /networks is DENIED (NETWORKS=0)", async () => {
    const r = await fetch(`${PROXY_URL}/networks`);
    expect(r.status).toBe(403);
  });

  itif("GET /info is DENIED (INFO=0)", async () => {
    const r = await fetch(`${PROXY_URL}/info`);
    expect(r.status).toBe(403);
  });

  itif("GET /images/json is DENIED (IMAGES=0)", async () => {
    const r = await fetch(`${PROXY_URL}/images/json`);
    expect(r.status).toBe(403);
  });
});
