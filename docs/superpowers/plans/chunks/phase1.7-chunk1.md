# Phase 1.7 — Chunk 1: Infra + logs fix + access-check + reader-switch

**Goal:** Ship compose changes (RO volume + docker.sock:ro + docker-socket-proxy + UID pin), add `/api/admin/config/access`, switch `config-reader.ts` to FS reads, fix log-streamer diagnostic, and verify `/admin/logs` works after deploy. No write path yet.

**Reference:** [Spec §Architecture/Infrastructure](../../specs/2026-04-20-pz-crcon-config-editor-and-server-controls-design.md).

---

## Task 1.1 — `lib/pz/access-check.ts`

**Files:**
- Create: `lib/pz/access-check.ts`
- Test: `tests/unit/pz/access-check.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/pz/access-check.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkConfigAccess, getConfigAccessOk } from "@/lib/pz/access-check";

describe("access-check", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pz-access-"));
    process.env.PZ_CONFIG_DIR = dir;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.PZ_CONFIG_DIR;
  });

  it("returns ok when dir is readable + writable", async () => {
    const res = await checkConfigAccess();
    expect(res.ok).toBe(true);
    expect(getConfigAccessOk()).toBe(true);
  });

  it("returns not-ok when dir does not exist", async () => {
    process.env.PZ_CONFIG_DIR = "/no/such/path/ever";
    const res = await checkConfigAccess();
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/ENOENT|does not exist/i);
    expect(getConfigAccessOk()).toBe(false);
  });
});
```

- [ ] **Step 2: Run → fail** (`pnpm vitest run tests/unit/pz/access-check.test.ts`)

- [ ] **Step 3: Implement**

```ts
// lib/pz/access-check.ts
import { access, constants } from "node:fs/promises";
import { getLogger } from "@/lib/logger";

const log = () => getLogger().child({ mod: "pz/access-check" });

let _ok = false;

export function getConfigAccessOk(): boolean {
  return _ok;
}

export interface AccessResult {
  ok: boolean;
  dir: string;
  reason?: string;
}

export async function checkConfigAccess(): Promise<AccessResult> {
  const dir = process.env.PZ_CONFIG_DIR ?? "/pz-data/Server";
  try {
    await access(dir, constants.R_OK | constants.W_OK);
    _ok = true;
    log().info({ dir }, "config dir accessible (r+w)");
    return { ok: true, dir };
  } catch (e) {
    _ok = false;
    const reason = e instanceof Error ? e.message : String(e);
    log().warn({ dir, reason }, "config dir not accessible");
    return { ok: false, dir, reason };
  }
}
```

- [ ] **Step 4: Re-run tests → pass.**

- [ ] **Step 5: Commit**

```bash
git add lib/pz/access-check.ts tests/unit/pz/access-check.test.ts
git commit -m "feat(pz): boot-time access check for PZ_CONFIG_DIR"
```

---

## Task 1.2 — `/api/admin/config/access` route

**Files:**
- Create: `app/api/admin/config/access/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkConfigAccess } from "@/lib/pz/access-check";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER")) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const res = await checkConfigAccess();
  return NextResponse.json(res);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/config/access/route.ts
git commit -m "feat(api): /api/admin/config/access surfaces FS access status"
```

---

## Task 1.3 — Wire access-check at WS server boot

**Files:**
- Modify: `server/ws.ts`

- [ ] **Step 1:** Near other boot initializers (find the `installLogStreamer()` call), add:

```ts
import { checkConfigAccess } from "@/lib/pz/access-check";
// ...
void checkConfigAccess().catch((e) => console.warn("access-check boot failed:", e));
```

Never throw at boot — the route-level gate surfaces the state.

- [ ] **Step 2: Commit**

```bash
git add server/ws.ts
git commit -m "chore(boot): run PZ_CONFIG_DIR access-check at server start"
```

---

## Task 1.4 — Switch `config-reader.ts` from docker-daemon-RPC to FS

**Files:**
- Modify: `lib/pz/config-reader.ts`
- Test: `tests/unit/pz/config-reader.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readServerIni, readSandboxVars } from "@/lib/pz/config-reader";

describe("config-reader (fs path)", () => {
  let dir: string;
  let serverDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pz-cr-"));
    serverDir = join(dir, "Server");
    await mkdir(serverDir, { recursive: true });
    process.env.PZ_CONFIG_DIR = serverDir;
    process.env.PZ_SERVER_PREFIX = "servertest";
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.PZ_CONFIG_DIR;
    delete process.env.PZ_SERVER_PREFIX;
  });

  it("reads ini from FS", async () => {
    await writeFile(join(serverDir, "servertest.ini"), "Open=true\nMaxPlayers=8\n");
    const r = await readServerIni();
    expect(r.ok).toBe(true);
    expect(r.parsed?.entries.find((e) => e.key === "Open")?.value).toBe("true");
  });

  it("returns ok:false when file missing", async () => {
    const r = await readServerIni();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ENOENT|not found/i);
  });

  it("reads sandbox from FS", async () => {
    const lua = `SandboxVars = {\n  VERSION = 5,\n  Zombies = {\n    Speed = 4,\n  },\n}\n`;
    await writeFile(join(serverDir, "servertest_SandboxVars.lua"), lua);
    const r = await readSandboxVars();
    expect(r.ok).toBe(true);
    expect(r.parsed?.flat["Zombies.Speed"]).toBe(4);
  });
});
```

- [ ] **Step 2: Rewrite `lib/pz/config-reader.ts`** — drop the daemon-RPC read (via `readContainerFile`), use `node:fs/promises` directly, add `mtimeMs` to result, add `PZ_SERVER_PREFIX` env override for local dev when the socket is unavailable.

```ts
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { envMapFrom, inspectContainer } from "@/lib/docker/client";
import { parseIni, type ParsedIni } from "./parse-ini";
import { parseSandboxLua, type ParsedSandbox } from "./parse-sandbox-lua";

const PZ_CONTAINER = process.env.PZ_CONTAINER_NAME ?? "pz-server";
const configDir = () => process.env.PZ_CONFIG_DIR ?? "/pz-data/Server";

export async function detectServerPrefix(): Promise<string> {
  const override = process.env.PZ_SERVER_PREFIX?.trim();
  if (override) return override;
  const info = await inspectContainer(PZ_CONTAINER);
  if (!info) return "servertest";
  const env = envMapFrom(info);
  return env.SERVERNAME?.trim() || "servertest";
}

export interface ServerIniResult {
  ok: boolean;
  prefix: string;
  path: string;
  mtimeMs?: number;
  parsed?: ParsedIni;
  raw?: string;
  error?: string;
}

export async function readServerIni(): Promise<ServerIniResult> {
  const prefix = await detectServerPrefix();
  const path = join(configDir(), `${prefix}.ini`);
  try {
    const raw = await readFile(path, "utf8");
    const { mtimeMs } = await stat(path);
    return { ok: true, prefix, path, mtimeMs, parsed: parseIni(raw), raw };
  } catch (e) {
    return { ok: false, prefix, path, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface SandboxVarsResult {
  ok: boolean;
  prefix: string;
  path: string;
  mtimeMs?: number;
  parsed?: ParsedSandbox;
  raw?: string;
  error?: string;
}

export async function readSandboxVars(): Promise<SandboxVarsResult> {
  const prefix = await detectServerPrefix();
  const path = join(configDir(), `${prefix}_SandboxVars.lua`);
  try {
    const raw = await readFile(path, "utf8");
    const { mtimeMs } = await stat(path);
    return { ok: true, prefix, path, mtimeMs, parsed: parseSandboxLua(raw), raw };
  } catch (e) {
    return { ok: false, prefix, path, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 3: Run → pass.**

- [ ] **Step 4: Commit**

```bash
git add lib/pz/config-reader.ts tests/unit/pz/config-reader.test.ts
git commit -m "feat(pz): read configs from FS (PZ_CONFIG_DIR), add mtime, PZ_SERVER_PREFIX override"
```

---

## Task 1.5 — Improve log-streamer diagnostic

**Files:**
- Modify: `lib/docker/client.ts` — have `tailContainerLogs()` return a tagged result `{ ok: true, handle } | { ok: false, reason: 'socket' | 'container' | 'other', detail }`.
- Modify: `lib/ws/log-streamer.ts` — consume the new shape, publish a clearer diagnostic line.

- [ ] **Step 1:** In `lib/docker/client.ts`, refactor `tailContainerLogs()`:

```ts
export type TailFailure = "socket" | "container" | "other";

export interface TailHandle {
  stream: NodeJS.ReadableStream;
  close: () => void;
}

export async function tailContainerLogs(
  containerName: string,
  opts: { tail?: number } = {},
): Promise<{ ok: true; handle: TailHandle } | { ok: false; reason: TailFailure; detail: string }> {
  const docker = getDocker();
  try { await docker.ping(); }
  catch (e) { return { ok: false, reason: "socket", detail: e instanceof Error ? e.message : String(e) }; }
  try {
    const container = docker.getContainer(containerName);
    const inspect = await container.inspect();
    if (!inspect.State?.Running) {
      return { ok: false, reason: "container", detail: `not running (status=${inspect.State?.Status})` };
    }
    const stream = (await container.logs({
      stdout: true, stderr: true, follow: true, tail: opts.tail ?? 100, timestamps: false,
    })) as unknown as NodeJS.ReadableStream;
    return {
      ok: true,
      handle: {
        stream,
        close: () => { try { (stream as unknown as { destroy?: () => void }).destroy?.(); } catch { /* ignore */ } },
      },
    };
  } catch (e) {
    return { ok: false, reason: "container", detail: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 2:** Update `lib/ws/log-streamer.ts` `startTail()` to consume the new shape, branching on `reason`.

- [ ] **Step 3: Commit**

```bash
git add lib/docker/client.ts lib/ws/log-streamer.ts
git commit -m "fix(logs): distinguish socket-missing vs container-missing in diagnostic"
```

---

## Task 1.6 — Verify `installLogStreamer()` wired at boot

**Files:**
- Modify (if needed): `server/ws.ts`

- [ ] **Step 1:** Grep for `installLogStreamer` in `server/ws.ts`. If absent, add an import + call near the WS server initialization.

- [ ] **Step 2: Commit (only if a change was needed)**

```bash
git add server/ws.ts
git commit -m "fix(ws): ensure log-streamer is installed at WS boot"
```

---

## Task 1.7 — Host compose update + deploy

**Files (on HomePL via SSH):**
- Modify: `/opt/docker/pz-crcon/docker-compose.yml`

- [ ] **Step 1:** Back up current compose on HomePL:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@85.215.222.81 \
  "cp /opt/docker/pz-crcon/docker-compose.yml /opt/docker/pz-crcon/docker-compose.yml.bak-$(date +%Y%m%d-%H%M)"
```

- [ ] **Step 2:** Replace the compose with the Chunk-1 shape. Full content:

```yaml
services:
  pz-crcon:
    image: majorluk/pz-crcon:latest
    container_name: pz-crcon
    restart: unless-stopped
    user: "1000:1000"
    networks: [proxy-net, db-net, pz-control-net]
    env_file: [.env]
    volumes:
      - pz-data:/pz-data:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      PZ_CONFIG_DIR: /pz-data/Server
      PZ_SERVER_DIR: /pz-data/Server
      DOCKER_CONTROL_URL: http://docker-socket-proxy:2375
      PZ_CONTAINER_NAME: pz-server
      PZ_BACKUP_DIR: /pz-data/Server/.backups
    labels: ["com.centurylinklabs.watchtower.enable=true"]
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/api/status || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:latest
    container_name: pz-crcon-socket-proxy
    restart: unless-stopped
    read_only: true
    networks: [pz-control-net]
    environment:
      CONTAINERS: 1
      POST: 1
      CONTAINERS_START: 1
      CONTAINERS_STOP: 1
      CONTAINERS_RESTART: 1
      CONTAINERS_KILL: 1
      EXEC: 0
      VOLUMES: 0
      NETWORKS: 0
      IMAGES: 0
      SYSTEM: 0
      INFO: 0
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro

volumes:
  pz-data:
    external: true

networks:
  proxy-net:
    external: true
  db-net:
    external: true
  pz-control-net: {}
```

- [ ] **Step 3:** Apply:

```bash
ssh -p 2222 -i ~/.ssh/id_ed25519 root@85.215.222.81 \
  "cd /opt/docker/pz-crcon && docker compose pull && docker compose up -d"
```

- [ ] **Step 4:** Verify:

```bash
# Proxy ping from inside pz-crcon
ssh ... "docker compose -f /opt/docker/pz-crcon/docker-compose.yml run --rm --no-deps --entrypoint sh pz-crcon -c 'wget -qO- http://docker-socket-proxy:2375/_ping'"
# Expected: OK

# Config dir listing
ssh ... "docker compose -f /opt/docker/pz-crcon/docker-compose.yml run --rm --no-deps --entrypoint sh pz-crcon -c 'ls /pz-data/Server/'"
# Expected: MajorlukPZ.ini, MajorlukPZ_SandboxVars.lua, etc.

# Browser: https://pz.majorluk.pl/admin/logs → live lines
# Browser: https://pz.majorluk.pl/api/admin/config/access → { ok: true, dir: "/pz-data/Server" }
```

- [ ] **Step 5:** Mirror the host compose in-repo at `docs/deployment/pz-crcon-compose-phase1.7.yml` (no secrets — only structure). Commit:

```bash
git add docs/deployment/pz-crcon-compose-phase1.7.yml
git commit -m "docs(deploy): snapshot Phase 1.7 host compose (RO + socket-proxy + UID pin)"
```

---

## Task 1.8 — Chunk 1 acceptance gate

- [ ] `/admin/logs` shows live `pz-server` lines in production (wait ≥10s after page load).
- [ ] `/api/admin/config/access` returns `{ ok: true }`.
- [ ] `/admin/config` still renders (read-only) with parsed sections from FS.
- [ ] `/admin` host-stats card still works (regression check on dockerode read socket).
- [ ] Open PR to main, merge via Watchtower pipeline.
