# Phase 1.7 — Chunk 5: Lifecycle + abort + proxy endpoint tests

**Goal:** Make the RestartPromptModal button actually work. Add start/stop/restart/force-stop/abort with graceful RCON flow, WS phase broadcast, and the `ServerControlsCard` dashboard widget.

---

## Task 5.1 — `lib/docker/control.ts` via proxy

**Files:**
- Create: `lib/docker/control.ts`

- [ ] **Step 1: Implement** — separate dockerode instance configured for TCP against `docker-socket-proxy`:

```ts
import Docker from "dockerode";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "docker/control" });

let _ctl: Docker | null = null;
function getCtl(): Docker {
  if (_ctl) return _ctl;
  const url = new URL(process.env.DOCKER_CONTROL_URL ?? "http://docker-socket-proxy:2375");
  _ctl = new Docker({ host: url.hostname, port: Number(url.port || 2375), protocol: "http" });
  return _ctl;
}

const PZ_NAME = process.env.PZ_CONTAINER_NAME ?? "pz-server";

export async function isProxyReachable(): Promise<boolean> {
  try { await getCtl().ping(); return true; }
  catch { return false; }
}

export async function inspectPz(): Promise<{ running: boolean; status: string; exitCode?: number } | null> {
  try {
    const info = await getCtl().getContainer(PZ_NAME).inspect();
    return {
      running: !!info.State?.Running,
      status: info.State?.Status ?? "unknown",
      exitCode: info.State?.ExitCode,
    };
  } catch { return null; }
}

export async function startPz(): Promise<void> {
  await getCtl().getContainer(PZ_NAME).start();
}

export async function stopPz(timeoutS = 30): Promise<void> {
  await getCtl().getContainer(PZ_NAME).stop({ t: timeoutS });
}

export async function restartPz(timeoutS = 30): Promise<void> {
  await getCtl().getContainer(PZ_NAME).restart({ t: timeoutS });
}

export async function killPz(): Promise<void> {
  await getCtl().getContainer(PZ_NAME).kill();
}

export async function waitForState(want: "running" | "exited", timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = await inspectPz();
    if (!s) return false;
    if (want === "running" && s.running) return true;
    if (want === "exited" && !s.running) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/docker/control.ts
git commit -m "feat(docker): TCP control client against docker-socket-proxy"
```

---

## Task 5.2 — Extend `lib/rcon/commands.ts`

**Files:**
- Modify: `lib/rcon/commands.ts`

- [ ] **Step 1:** Add helpers. `saveWorld` awaits the response line for a terminator, with a timeout that falls through rather than hanging the lifecycle:

```ts
import { rconSend } from "./client";

export async function servermsg(text: string): Promise<string> {
  return rconSend(`servermsg "${text.replace(/"/g, '\\"')}"`);
}

export async function saveWorld(timeoutMs = 120_000): Promise<{ ok: boolean; response: string }> {
  try {
    const r = await Promise.race([
      rconSend("save"),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("save-timeout")), timeoutMs)),
    ]);
    return { ok: true, response: r };
  } catch (e) {
    return { ok: false, response: e instanceof Error ? e.message : String(e) };
  }
}

export async function quitServer(): Promise<string> {
  return rconSend("quit");
}

export async function reloadOptions(): Promise<string> {
  return rconSend("reloadoptions");
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/rcon/commands.ts
git commit -m "feat(rcon): servermsg, saveWorld (with timeout), quitServer, reloadOptions"
```

---

## Task 5.3 — `lib/ws/channels.ts` + `lib/server/lifecycle.ts`

**Files:**
- Modify: `lib/ws/channels.ts`
- Create: `lib/server/lifecycle.ts`
- Create: `tests/unit/pz/lifecycle.test.ts`
- Create: `tests/unit/pz/lifecycle.proxy-down.test.ts`

- [ ] **Step 1:** Add `server:lifecycle` channel with payload `{ phase, detail?, at }`.

- [ ] **Step 2: Lifecycle module:**

```ts
import { Mutex } from "async-mutex";
import { publish } from "@/lib/ws/server";
import { servermsg, saveWorld, quitServer } from "@/lib/rcon/commands";
import { startPz, stopPz, killPz, waitForState, inspectPz, isProxyReachable } from "@/lib/docker/control";
import { registerLifecyclePhaseGetter } from "@/lib/pz/writer";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "lifecycle" });

export type Phase = "idle" | "warning" | "saving" | "stopping" | "starting";

let phase: Phase = "idle";
let phaseDetail: string | undefined;
let abortSignalled = false;

export function getPhase(): Phase { return phase; }
export function getDetail(): string | undefined { return phaseDetail; }

registerLifecyclePhaseGetter(getPhase);

function emit(p: Phase, detail?: string) {
  phase = p;
  phaseDetail = detail;
  publish("server:lifecycle", { phase: p, detail, at: Date.now() });
  log().info({ phase: p, detail }, "lifecycle phase");
}

const mutex = new Mutex();

export class LifecycleBusyError extends Error { code = "lifecycle-busy" as const; }
export class ProxyUnreachableError extends Error { code = "proxy-unreachable" as const; }

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await mutex.acquire();
  try { return await fn(); } finally { release(); }
}

export function abortCurrent(): void {
  if (phase === "idle") return;
  abortSignalled = true;
  log().warn({ phase }, "lifecycle abort requested");
}

export async function gracefulRestart(warningSeconds = 30): Promise<void> {
  if (!(await isProxyReachable())) throw new ProxyUnreachableError();
  if (mutex.isLocked()) throw new LifecycleBusyError();
  return withLock(async () => {
    abortSignalled = false;
    try {
      const probe = await inspectPz();
      const running = probe?.running ?? false;
      if (running) {
        emit("warning", `${warningSeconds}s`);
        try {
          await servermsg(`Server restarting in ${warningSeconds}s (config reload). Please log out.`);
        } catch { /* RCON down, continue */ }
        for (let i = 0; i < warningSeconds; i++) {
          if (abortSignalled) throw new Error("aborted");
          await new Promise((r) => setTimeout(r, 1000));
        }
        emit("saving");
        const saveRes = await saveWorld(120_000);
        if (!saveRes.ok) emit("saving", `save-timeout-proceeding`);
        emit("stopping");
        try { await quitServer(); } catch { /* ignore */ }
        const exited = await waitForState("exited", 90_000);
        if (!exited) {
          await stopPz(30);
          const stopped2 = await waitForState("exited", 35_000);
          if (!stopped2) await killPz();
        }
      }
      emit("starting");
      await startPz();
      const up = await waitForState("running", 600_000);
      if (!up) { emit("idle", "start-failed"); return; }
      await new Promise((r) => setTimeout(r, 30_000));
      const finalState = await inspectPz();
      emit("idle", finalState?.running ? undefined : `start-failed exit=${finalState?.exitCode ?? "?"}`);
    } catch (e) {
      emit("idle", `error ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  });
}

export async function gracefulStop(warningSeconds = 30): Promise<void> { /* analogous, no start */ }
export async function forceStop(): Promise<void> { /* no RCON, kill, emit idle */ }
export async function startIfStopped(): Promise<void> { /* emits starting → idle */ }
```

- [ ] **Step 3: Unit test (`lifecycle.test.ts`)** — `vi.mock` on `@/lib/docker/control` and `@/lib/rcon/commands`. Assert:
  - Happy-path phase sequence: warning → saving → stopping → starting → idle
  - Concurrent call → `LifecycleBusyError`
  - Save-timeout path still proceeds to stop (emits `save-timeout-proceeding`)
  - RCON-down path still stops cleanly (`servermsg` throws, flow continues)
  - `abortCurrent()` interrupts a pending warning phase

- [ ] **Step 4: `lifecycle.proxy-down.test.ts`** — when `isProxyReachable()` returns false, `gracefulRestart` throws `ProxyUnreachableError` and no phase change is published.

- [ ] **Step 5: Commit**

```bash
git add lib/ws/channels.ts lib/server/lifecycle.ts tests/unit/pz/lifecycle.test.ts tests/unit/pz/lifecycle.proxy-down.test.ts
git commit -m "feat(server): lifecycle orchestration with mutex, phase broadcast, abort"
```

---

## Task 5.4 — Lifecycle API routes

**Files:**
- Create: `app/api/admin/server/start/route.ts`
- Create: `app/api/admin/server/stop/route.ts`
- Create: `app/api/admin/server/restart/route.ts`
- Create: `app/api/admin/server/force-stop/route.ts`
- Create: `app/api/admin/server/abort/route.ts`
- Create: `app/api/admin/server/state/route.ts`
- Create: `tests/integration/api.server.test.ts`

- [ ] **Step 1:** All mutating routes share a skeleton: require ADMIN (OWNER for force-stop), CSRF check, call lifecycle function, record audit. Example `restart/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { gracefulRestart, LifecycleBusyError, ProxyUnreachableError } from "@/lib/server/lifecycle";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "ADMIN"))
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  const csrf = checkCsrf(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, code: "csrf" }, { status: 403 });
  const t0 = Date.now();
  try {
    await gracefulRestart(30);
    await recordAudit(session.userId, "LIFECYCLE_RESTART", { durationMs: Date.now() - t0 });
    return NextResponse.json({ ok: true, durationMs: Date.now() - t0 });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "error";
    const status = code === "lifecycle-busy" ? 409 : code === "proxy-unreachable" ? 503 : 500;
    return NextResponse.json({ ok: false, code, detail: e instanceof Error ? e.message : "" }, { status });
  }
}
```

- [ ] **Step 2:** Force-stop requires OWNER and body `{ confirm: "FORCE-STOP" }` (exact string match, server-side). State route returns `{ containerState, rconOnline, lifecyclePhase, proxyReachable, players, uptime }`.

- [ ] **Step 3:** Integration test for the endpoint matrix — mock lifecycle fns; verify:
  - VIEWER → 403 on all mutating endpoints
  - ADMIN can hit start/stop/restart but not force-stop (403)
  - OWNER can hit force-stop with correct confirm body; wrong confirm → 400
  - Concurrent restart → second call returns 409
  - Proxy unreachable → 503

- [ ] **Step 4: Commit** in 6 small commits, one per route:

```bash
git add app/api/admin/server/start/route.ts && git commit -m "feat(api): POST server/start"
git add app/api/admin/server/stop/route.ts && git commit -m "feat(api): POST server/stop (graceful)"
git add app/api/admin/server/restart/route.ts && git commit -m "feat(api): POST server/restart (graceful)"
git add app/api/admin/server/force-stop/route.ts && git commit -m "feat(api): POST server/force-stop (OWNER, confirm)"
git add app/api/admin/server/abort/route.ts && git commit -m "feat(api): POST server/abort"
git add app/api/admin/server/state/route.ts && git commit -m "feat(api): GET server/state"
git add tests/integration/api.server.test.ts && git commit -m "test(int): server lifecycle endpoint matrix"
```

---

## Task 5.5 — `ServerControlsCard` + `LifecyclePhaseBadge`

**Files:**
- Create: `components/server/lifecycle-phase-badge.tsx`
- Create: `components/server/server-controls-card.tsx`
- Modify: `app/(admin)/admin/page.tsx`
- Modify: `components/config/restart-prompt-modal.tsx`

- [ ] **Step 1:** `LifecyclePhaseBadge` — subscribes to WS `server:lifecycle`, falls back to `/api/admin/server/state` on initial render. Renders phase + optional countdown for `phase === 'warning'`.

- [ ] **Step 2:** `ServerControlsCard`:
  - Four buttons: Start / Stop / Restart / Force stop
  - Enabled based on `phase`, `containerState`, `proxyReachable`
  - Force-stop opens a confirm dialog requiring the literal string `FORCE-STOP` typed in
  - Abort button appears during non-idle phases (except `starting`)
  - Every action uses `csrfFetch` and toasts the result

- [ ] **Step 3:** Wire `RestartPromptModal`'s primary button to actually call `csrfFetch('/api/admin/server/restart', { method: 'POST' })`. Flip `canRestart` to true (drop the Chunk 4 placeholder guard).

- [ ] **Step 4:** Add `<ServerControlsCard />` to the `/admin` dashboard grid.

- [ ] **Step 5: Commit**

```bash
git add components/server/lifecycle-phase-badge.tsx components/server/server-controls-card.tsx app/(admin)/admin/page.tsx components/config/restart-prompt-modal.tsx
git commit -m "feat(ui): ServerControlsCard + LifecyclePhaseBadge; restart-prompt enabled"
```

---

## Task 5.6 — Docker-proxy endpoint smoke test

**Files:**
- Create: `tests/integration/docker-proxy.endpoints.test.ts`

- [ ] **Step 1:** Hits each endpoint we depend on against a real `tecnativa/docker-socket-proxy` container started in docker-in-docker CI. Allowed calls should 2xx; disallowed (`POST /exec`, `POST /volumes/...`, `GET /networks`, `GET /info`) should 403.

Skeleton:

```ts
import { describe, it, expect } from "vitest";

const PROXY_URL = process.env.DOCKER_PROXY_TEST_URL ?? "http://localhost:2375";

describe("docker-socket-proxy endpoint matrix", () => {
  it.skipIf(!process.env.DOCKER_IN_DOCKER)("GET /containers/json allowed", async () => {
    const r = await fetch(`${PROXY_URL}/containers/json`);
    expect(r.status).toBe(200);
  });

  it.skipIf(!process.env.DOCKER_IN_DOCKER)("POST /exec disallowed", async () => {
    const r = await fetch(`${PROXY_URL}/containers/foo/exec`, { method: "POST" });
    expect(r.status).toBe(403);
  });

  // ... repeat for start/stop/restart/kill/volumes/networks/info
});
```

Add a GH Actions job step that:
1. Runs `docker run -d --name proxy -p 2375:2375 -v /var/run/docker.sock:/var/run/docker.sock:ro -e CONTAINERS=1 -e POST=1 -e CONTAINERS_START=1 -e CONTAINERS_STOP=1 -e CONTAINERS_RESTART=1 -e CONTAINERS_KILL=1 tecnativa/docker-socket-proxy:latest`
2. Sets `DOCKER_IN_DOCKER=1 DOCKER_PROXY_TEST_URL=http://localhost:2375`
3. `pnpm vitest run tests/integration/docker-proxy.endpoints.test.ts`

- [ ] **Step 2: Commit**

```bash
git add tests/integration/docker-proxy.endpoints.test.ts .github/workflows/ci.yml
git commit -m "test(int): docker-socket-proxy endpoint matrix smoke test"
```

---

## Task 5.7 — Chunk 5 acceptance gate

- [ ] On live `pz.majorluk.pl`, press Restart — in-game `servermsg` appears with 30s countdown, save completes, quit, container bounces, restart completes, UI phase returns to `idle`.
- [ ] Press Restart twice fast — second click returns 409 with UI toast "Lifecycle busy".
- [ ] Stop `docker-socket-proxy` container — UI controls disable with "Proxy unreachable" banner.
- [ ] Force-stop confirm requires typing `FORCE-STOP` exactly.
- [ ] Config save → "Restart now" one-shot flow works end-to-end.
- [ ] Audit log shows `LIFECYCLE_RESTART` row with `durationMs`.
- [ ] Root `CLAUDE.md` updated with Phase 1.7 shipped reference in the PZ-CRCON row.
- [ ] PR to main, merge.
