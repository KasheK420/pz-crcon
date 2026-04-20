# Phase 1.7 — Chunk 4: Config API + editable UI + audit

**Goal:** Wire PUT endpoints, typed controls, diff modal, restart-prompt modal (restart button disabled until Chunk 5), audit card. End state: admin can edit config in the UI; restart still via SSH.

---

## Task 4.1 — CSRF fetch wrapper

**Files:**
- Create: `lib/csrf/fetch.ts`
- Create: `lib/csrf/check.ts`

- [ ] **Step 1: Client wrapper.** Reads the `next-auth.csrf-token` cookie and injects `X-CSRF-Token` on mutating methods. Auth.js writes the cookie in one of three names depending on URL scheme:

```ts
"use client";

function getCsrfToken(): string | null {
  const names = ["next-auth.csrf-token", "__Secure-next-auth.csrf-token", "__Host-next-auth.csrf-token"];
  const raw = document.cookie.split("; ").find((c) => names.some((n) => c.startsWith(`${n}=`)));
  if (!raw) return null;
  const v = decodeURIComponent(raw.split("=")[1] ?? "");
  return v.split("|")[0] ?? null;
}

export async function csrfFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const mutating = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  const headers = new Headers(init.headers);
  if (mutating) {
    const t = getCsrfToken();
    if (t) headers.set("X-CSRF-Token", t);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}
```

- [ ] **Step 2: Server check helper** (`lib/csrf/check.ts`):

```ts
import type { NextRequest } from "next/server";

export function checkCsrf(req: NextRequest): { ok: boolean; reason?: string } {
  const header = req.headers.get("x-csrf-token");
  if (!header) return { ok: false, reason: "missing-header" };
  const cookieName = ["__Host-next-auth.csrf-token", "__Secure-next-auth.csrf-token", "next-auth.csrf-token"]
    .find((n) => req.cookies.get(n));
  if (!cookieName) return { ok: false, reason: "missing-cookie" };
  const cookieValue = req.cookies.get(cookieName)!.value;
  const tokenFromCookie = decodeURIComponent(cookieValue).split("|")[0];
  if (tokenFromCookie !== header) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/csrf/fetch.ts lib/csrf/check.ts
git commit -m "feat(csrf): reuse Auth.js csrf-token for admin mutations"
```

---

## Task 4.2 — Audit helpers + route

**Files:**
- Create: `lib/server/audit.ts`
- Create: `app/api/admin/audit/route.ts`

- [ ] **Step 1:** `lib/server/audit.ts`:

```ts
import { prisma } from "@/lib/db/client";
import { AuditKind } from "@prisma/client";

export async function recordAudit(userId: string, kind: AuditKind, detail: Record<string, unknown>) {
  try {
    await prisma.auditEvent.create({ data: { userId, kind, detail } });
  } catch (e) {
    console.error("audit write failed:", e);
  }
}
```

- [ ] **Step 2: Route:**

```ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "MODERATOR"))
    return NextResponse.json({ ok: false }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 25));
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const rows = await prisma.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, userId: true, kind: true, detail: true, createdAt: true },
  });
  const nextCursor = rows.length > limit ? rows.pop()!.id : null;
  return NextResponse.json({ ok: true, rows, nextCursor });
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/server/audit.ts app/api/admin/audit/route.ts
git commit -m "feat(audit): recordAudit helper + GET /api/admin/audit"
```

---

## Task 4.3 — PUT `/api/admin/config/ini` + redacted GET + OWNER-only secrets

**Files:**
- Modify/create: `app/api/admin/config/ini/route.ts`
- Create: `app/api/admin/config/ini/secrets/route.ts`
- Create: `tests/unit/pz/secrets.redaction.test.ts`

- [ ] **Step 1:** Ini route with server-side redaction + PUT gate:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkCsrf } from "@/lib/csrf/check";
import { readServerIni } from "@/lib/pz/config-reader";
import { writeServerIni } from "@/lib/pz/writer";
import { INI_DESCRIPTORS } from "@/lib/pz/ini-descriptors";
import { recordAudit } from "@/lib/server/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER"))
    return NextResponse.json({ ok: false }, { status: 401 });
  const r = await readServerIni();
  if (!r.ok) return NextResponse.json(r, { status: 503 });
  const redact = !atLeast(session.role, "OWNER");
  const entries = r.parsed!.entries.map((e) => {
    const d = INI_DESCRIPTORS[e.key];
    if (redact && d?.secret) return { key: e.key, value: "__REDACTED__", redacted: true };
    return { key: e.key, value: e.value };
  });
  return NextResponse.json({ ok: true, path: r.path, prefix: r.prefix, mtimeMs: r.mtimeMs, entries });
}

const PutBody = z.object({
  clientMtimeMs: z.number(),
  patch: z.record(z.union([z.string(), z.number(), z.boolean()])),
});

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "OWNER"))
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  const csrf = checkCsrf(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, code: "csrf", reason: csrf.reason }, { status: 403 });
  const body = PutBody.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ ok: false, code: "bad-request" }, { status: 400 });
  const result = await writeServerIni(body.data.patch, { clientMtimeMs: body.data.clientMtimeMs });
  if (!result.ok) {
    const status = result.code === "mtime-race" || result.code === "lifecycle-busy" || result.code === "config-busy" ? 409
      : result.code === "config-dir-unreachable" ? 503
      : result.code === "validation" ? 400
      : 500;
    return NextResponse.json(result, { status });
  }
  const requiresRestart = result.diff.some((d) => INI_DESCRIPTORS[d.path]?.requiresRestart);
  await recordAudit(session.userId, "CONFIG_WRITE", { file: "ini", diff: result.diff });
  return NextResponse.json({ ...result, requiresRestart });
}
```

- [ ] **Step 2:** OWNER-only secrets route (`app/api/admin/config/ini/secrets/route.ts`):

```ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { readServerIni } from "@/lib/pz/config-reader";
import { INI_DESCRIPTORS } from "@/lib/pz/ini-descriptors";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "OWNER"))
    return NextResponse.json({ ok: false }, { status: 401 });
  const r = await readServerIni();
  if (!r.ok) return NextResponse.json(r, { status: 503 });
  const secrets: Record<string, string> = {};
  for (const e of r.parsed!.entries) {
    if (INI_DESCRIPTORS[e.key]?.secret) secrets[e.key] = String(e.value);
  }
  return NextResponse.json({ ok: true, secrets });
}
```

- [ ] **Step 3:** Redaction unit test — mock session helper + fs, assert VIEWER never gets raw password, OWNER does.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/config/ini/route.ts app/api/admin/config/ini/secrets/route.ts tests/unit/pz/secrets.redaction.test.ts
git commit -m "feat(api): PUT config/ini + OWNER secrets + server-side redaction"
```

---

## Task 4.4 — PUT `/api/admin/config/sandbox`

**Files:**
- Modify/create: `app/api/admin/config/sandbox/route.ts`
- Create: `tests/integration/api.config.test.ts`

- [ ] **Step 1:** Analogous shape to ini. GET returns `{ ok, mtimeMs, sections, descriptors }`. PUT consumes `{ clientMtimeMs, patch }` and returns `{ ok, diff, newMtimeMs, requiresRestart: true }` (all sandbox keys are restart-only). Records `CONFIG_WRITE` audit with `{ file: "sandbox", diff }`.

- [ ] **Step 2: Integration test** — mock request objects; cover:
  - VIEWER PUT → 403
  - missing CSRF → 403
  - mtime mismatch → 409
  - validation error → 400
  - happy path → 200 with diff + `requiresRestart: true`

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/config/sandbox/route.ts tests/integration/api.config.test.ts
git commit -m "feat(api): PUT config/sandbox with diff + restart-prompt signal"
```

---

## Task 4.5 — `SandboxVarControl`, `EditableIniRow`, `SecretsReveal`

**Files:**
- Create: `components/config/sandbox-var-control.tsx`
- Create: `components/config/editable-ini-row.tsx`
- Create: `components/config/secrets-reveal.tsx`

- [ ] **Step 1: `SandboxVarControl`** — given descriptor + current value + onChange, render the correct shadcn primitive:

```tsx
"use client";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SandboxDescriptor } from "@/lib/pz/sandbox-descriptors";

interface Props {
  descriptor: SandboxDescriptor;
  value: boolean | number | string;
  onChange: (v: boolean | number | string) => void;
}

export function SandboxVarControl({ descriptor, value, onChange }: Props) {
  switch (descriptor.type) {
    case "bool":
      return <Switch checked={!!value} onCheckedChange={onChange} />;
    case "enum":
      return (
        <Select
          value={String(value)}
          onValueChange={(v) => onChange(descriptor.options!.find((o) => String(o.value) === v)!.value)}
        >
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {descriptor.options!.map((o) => (
              <SelectItem key={String(o.value)} value={String(o.value)}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "int":
    case "float":
      if (descriptor.min !== undefined && descriptor.max !== undefined) {
        return (
          <div className="flex items-center gap-3">
            <Slider
              min={descriptor.min} max={descriptor.max}
              step={descriptor.step ?? (descriptor.type === "int" ? 1 : 0.01)}
              value={[Number(value)]}
              onValueChange={(a) => onChange(a[0]!)}
              className="flex-1"
            />
            <Input
              type="number" className="w-20 pz-mono"
              value={Number(value)}
              min={descriptor.min} max={descriptor.max}
              step={descriptor.step ?? (descriptor.type === "int" ? 1 : 0.01)}
              onChange={(ev) => {
                const n = descriptor.type === "int"
                  ? parseInt(ev.currentTarget.value, 10)
                  : parseFloat(ev.currentTarget.value);
                if (!Number.isNaN(n)) onChange(n);
              }}
            />
          </div>
        );
      }
      return (
        <Input type="number" value={Number(value)}
          onChange={(ev) => { const n = parseFloat(ev.currentTarget.value); if (!Number.isNaN(n)) onChange(n); }}
        />
      );
    case "string":
      return <Input value={String(value)} onChange={(ev) => onChange(ev.currentTarget.value)} />;
  }
}
```

- [ ] **Step 2: `EditableIniRow`** — same pattern against `IniDescriptor`. For `secret: true`, renders through `SecretsReveal`.

- [ ] **Step 3: `SecretsReveal`** — when clicked (OWNER-only), fetches `/api/admin/config/ini/secrets` and reveals the value inline. Non-OWNERs see only `••••••`.

- [ ] **Step 4: Commit**

```bash
git add components/config/sandbox-var-control.tsx components/config/editable-ini-row.tsx components/config/secrets-reveal.tsx
git commit -m "feat(ui): editable typed controls + secrets reveal"
```

---

## Task 4.6 — `DiffModal` + `RestartPromptModal`

**Files:**
- Create: `components/config/diff-modal.tsx`
- Create: `components/config/restart-prompt-modal.tsx`

- [ ] **Step 1: `DiffModal`** — shadcn `Dialog`, props `{ diff: Array<{ path, from, to }>, onConfirm, onCancel }`. Renders a compact 3-column monospace table.

- [ ] **Step 2: `RestartPromptModal`** — shadcn `Dialog`, props `{ open, onRestart, onLater, canRestart }`. In Chunk 4, `canRestart` is hardcoded `false` — primary button disabled with tooltip "Lifecycle ships in Phase 1.7 Chunk 5". Chunk 5 flips it.

- [ ] **Step 3: Commit**

```bash
git add components/config/diff-modal.tsx components/config/restart-prompt-modal.tsx
git commit -m "feat(ui): diff modal + restart prompt modal (restart disabled in this chunk)"
```

---

## Task 4.7 — Refactor `config-tabs.tsx` to editable

**Files:**
- Modify: `components/config/config-tabs.tsx`
- Modify: `app/(admin)/admin/config/page.tsx`

- [ ] **Step 1:** Wrap children with an edit-buffer context. Each tab holds `{ dirty, draft, serverValues, mtime }`. Save button enables when `dirty`. On save: call `csrfFetch(PUT /api/admin/config/<kind>, { clientMtimeMs, patch })`, open `DiffModal` on success.

- [ ] **Step 2:** Replace read-only field rendering with the new typed controls.

- [ ] **Step 3:** Update `app/(admin)/admin/config/page.tsx` — remove the "Read-only" banner, pass descriptors down, add a banner tied to `/api/admin/config/access` ok-flag (red banner if access is broken).

- [ ] **Step 4: Commit**

```bash
git add components/config/config-tabs.tsx app/(admin)/admin/config/page.tsx
git commit -m "feat(ui): editable config tabs with per-section save + diff flow"
```

---

## Task 4.8 — Audit card on `/admin`

**Files:**
- Create: `components/audit/audit-card.tsx`
- Modify: `app/(admin)/admin/page.tsx`

- [ ] **Step 1:** `AuditCard` fetches `/api/admin/audit?limit=25`, renders `{ createdAt, userName, kind, detail-summary }` list. "Load more" paginates via `cursor`.

- [ ] **Step 2:** Add `<AuditCard />` to the dashboard grid.

- [ ] **Step 3: Commit**

```bash
git add components/audit/audit-card.tsx app/(admin)/admin/page.tsx
git commit -m "feat(ui): audit card on admin dashboard"
```

---

## Task 4.9 — Chunk 4 acceptance gate

- [ ] Change a sandbox var in the UI, save, diff modal confirms, server file updated, `.bak-<iso>` in `.backups/`.
- [ ] Change an ini key, same flow.
- [ ] `AuditEvent` row visible in audit card within 3s.
- [ ] RestartPromptModal shows but "Restart now" is disabled.
- [ ] VIEWER sees RCON password as `••••••` and the GET response never returns the real value (verify in browser DevTools Network tab).
- [ ] OWNER reveal toggle shows the real value.
- [ ] PR to main, merge.
