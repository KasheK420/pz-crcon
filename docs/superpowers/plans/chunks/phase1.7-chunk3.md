# Phase 1.7 — Chunk 3: Writer + validators + source-offset parser

**Goal:** Atomic, locked, mtime-checked writes for both config files, preserving comments/whitespace/structure. Flip the `pz-data` mount to `:rw` during this chunk's deploy. Add `AuditEvent` Prisma model.

---

## Task 3.1 — Add source-offset tracking to `parse-sandbox-lua.ts`

**Files:**
- Modify: `lib/pz/parse-sandbox-lua.ts`
- Test: extend `tests/unit/pz/parse-sandbox-lua.test.ts`

- [ ] **Step 1:** Extend `SandboxEntry` with `valueStart: number`, `valueEnd: number` — byte offsets in the original source string.

- [ ] **Step 2:** Thread offsets through `walkTable` — currently works on a `body` slice; propagate a `baseOffset` param so offsets are in original-source coordinates.

- [ ] **Step 3:** Round-trip assertion test:

```ts
it("source offsets resolve to the exact raw value literal", () => {
  const src = `SandboxVars = {\n  Zombies = {\n    Speed = 4,\n    Strength = 2,\n  },\n}\n`;
  const p = parseSandboxLua(src);
  for (const section of p.sections) {
    for (const entry of section.entries) {
      const slice = src.slice(entry.valueStart, entry.valueEnd);
      expect(slice.trim()).toBe(String(entry.value));
    }
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add lib/pz/parse-sandbox-lua.ts tests/unit/pz/parse-sandbox-lua.test.ts
git commit -m "feat(pz): sandbox parser emits source offsets per key"
```

---

## Task 3.2 — `serialize-ini.ts` line-based rewriter

**Files:**
- Create: `lib/pz/serialize-ini.ts`
- Test: `tests/unit/pz/serialize-ini.test.ts`

- [ ] **Step 1: Write test** — same shape as the serialize-sandbox test in Task 3.3. Assertions:
  - replaces matched key values line-by-line
  - preserves surrounding whitespace and case (`  Open =   false   ` → `  Open =   true   `)
  - leaves unknown keys untouched
  - preserves CRLF line endings when source uses them
  - preserves trailing comment on same line (`Open=false  # default` → `Open=true  # default`)

- [ ] **Step 2: Implement**

Match each line with a regex pattern like `^(\s*)([A-Za-z_][\w]*)(\s*)=(\s*)(.*)$`; use `RegExp.prototype.test()` for fast-reject and `String.prototype.match()` to capture groups. For lines that match and have a key in the patch, rebuild the line preserving all captured whitespace and any inline trailing `#`/`;` comment. For non-matching lines, pass them through verbatim. Detect EOL (`\r\n` vs `\n`) from the first line break and preserve it on join.

```ts
type Scalar = string | number | boolean;
const LINE_PATTERN = /^(\s*)([A-Za-z_][\w]*)(\s*)=(\s*)(.*)$/;

function scalarToString(v: Scalar): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function serializeIni(src: string, patch: Record<string, Scalar>): string {
  if (Object.keys(patch).length === 0) return src;
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(LINE_PATTERN);
    if (!m) { out.push(line); continue; }
    const [, lead, key, ws1, ws2, tail] = m;
    if (!(key in patch)) { out.push(line); continue; }
    const cmtIdx = tail.search(/\s+#|\s+;/);
    const valueSlice = cmtIdx >= 0 ? tail.slice(0, cmtIdx) : tail;
    const trailer = cmtIdx >= 0 ? tail.slice(cmtIdx) : "";
    const trimmedValue = valueSlice.replace(/\s+$/, "");
    const trailingWs = valueSlice.slice(trimmedValue.length);
    out.push(`${lead}${key}${ws1}=${ws2}${scalarToString(patch[key])}${trailingWs}${trailer}`);
  }
  return out.join(eol);
}
```

- [ ] **Step 3: Run → pass. Commit.**

```bash
git add lib/pz/serialize-ini.ts tests/unit/pz/serialize-ini.test.ts
git commit -m "feat(pz): serialize-ini line-based rewriter preserving structure"
```

---

## Task 3.3 — `serialize-sandbox-lua.ts` offset-based replacement

**Files:**
- Create: `lib/pz/serialize-sandbox-lua.ts`
- Test: `tests/unit/pz/serialize-sandbox-lua.test.ts`

- [ ] **Step 1: Test** — assertions:
  - swaps scalar values via parser offsets
  - round-trips on the live fixture with empty patch
  - throws `unknown-key` for paths not present in source

- [ ] **Step 2: Implement** — walk parsed sections, build a `Map<path, {valueStart, valueEnd}>`, validate every target path exists, sort edits by offset descending, apply splice end-to-start so earlier offsets remain valid.

```ts
import { parseSandboxLua } from "./parse-sandbox-lua";

type Scalar = number | string | boolean;

function scalarLiteral(v: Scalar): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function serializeSandboxLua(src: string, patch: Record<string, Scalar>): string {
  const keys = Object.keys(patch);
  if (keys.length === 0) return src;

  const parsed = parseSandboxLua(src);
  const offsetByPath = new Map<string, { valueStart: number; valueEnd: number }>();
  for (const section of parsed.sections) {
    for (const entry of section.entries) {
      const path = section.name === "_root" ? entry.key : `${section.name}.${entry.key}`;
      offsetByPath.set(path, { valueStart: entry.valueStart, valueEnd: entry.valueEnd });
    }
  }

  for (const k of keys) {
    if (!offsetByPath.has(k)) {
      const err = new Error(`unknown-key: ${k}`);
      (err as Error & { code?: string }).code = "unknown-key";
      throw err;
    }
  }

  const edits = keys
    .map((k) => ({ path: k, ...offsetByPath.get(k)!, value: patch[k] }))
    .sort((a, b) => b.valueStart - a.valueStart);

  let out = src;
  for (const e of edits) {
    out = out.slice(0, e.valueStart) + scalarLiteral(e.value) + out.slice(e.valueEnd);
  }
  return out;
}
```

- [ ] **Step 3: Run → pass. Commit.**

```bash
git add lib/pz/serialize-sandbox-lua.ts tests/unit/pz/serialize-sandbox-lua.test.ts
git commit -m "feat(pz): serialize-sandbox-lua offset-based, preserves structure"
```

---

## Task 3.4 — `validate.ts` — Zod builders from descriptors

**Files:**
- Create: `lib/pz/validate.ts`
- Test: `tests/unit/pz/validate.test.ts`

- [ ] **Step 1: Test** — assertions:
  - accepts in-range int (`Zombies.Speed: 2`)
  - rejects out-of-range (`Zombies.Speed: 99`)
  - rejects unknown key (`Nope.X`)
  - rejects wrong type (bool key given a number)

- [ ] **Step 2: Implement** — build a Zod schema per descriptor type:

```ts
import { z } from "zod";
import { describeSandbox, type SandboxDescriptor } from "./sandbox-descriptors";
import { INI_DESCRIPTORS } from "./ini-descriptors";

export interface ValidationError {
  path: string;
  code: "unknown-key" | "type" | "range" | "enum";
  message: string;
}

export interface ValidationResult { ok: boolean; errors?: ValidationError[]; }

function schemaForSandbox(d: SandboxDescriptor): z.ZodTypeAny {
  switch (d.type) {
    case "bool": return z.boolean();
    case "int": {
      let s = z.number().int();
      if (d.min !== undefined) s = s.min(d.min);
      if (d.max !== undefined) s = s.max(d.max);
      return s;
    }
    case "float": {
      let s = z.number();
      if (d.min !== undefined) s = s.min(d.min);
      if (d.max !== undefined) s = s.max(d.max);
      return s;
    }
    case "enum":
      return z.union([
        z.number().refine((v) => d.options!.some((o) => o.value === v)),
        z.string().refine((v) => d.options!.some((o) => o.value === v)),
      ]);
    case "string": return z.string();
  }
}

export function validateSandboxPatch(patch: Record<string, unknown>): ValidationResult {
  const errors: ValidationError[] = [];
  for (const [path, raw] of Object.entries(patch)) {
    const d = describeSandbox(path);
    if (!d) { errors.push({ path, code: "unknown-key", message: `no descriptor for ${path}` }); continue; }
    const parsed = schemaForSandbox(d).safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const code: ValidationError["code"] =
        first.code === "too_small" || first.code === "too_big" ? "range" :
        first.code === "invalid_type" ? "type" :
        first.code === "custom" ? "enum" : "type";
      errors.push({ path, code, message: first.message });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// validateIniPatch — analogous, handles "csv" and "string" as z.string(), "bool" as z.enum(["true","false"]).
```

- [ ] **Step 3: Run → pass. Commit.**

```bash
git add lib/pz/validate.ts tests/unit/pz/validate.test.ts
git commit -m "feat(pz): Zod validators built from descriptors"
```

---

## Task 3.5 — Install `async-mutex`

- [ ] `pnpm add async-mutex` then commit `package.json` + `pnpm-lock.yaml`.

---

## Task 3.6 — `lib/pz/writer.ts` — atomic writer with mutex, mtime, backups

**Files:**
- Create: `lib/pz/writer.ts`
- Tests: `tests/unit/pz/writer.round-trip.test.ts`, `writer.backup.test.ts`, `writer.mtime-race.test.ts`, `writer.config-busy.test.ts`, `writer.lifecycle-gate.test.ts`, `writer.fs-errors.test.ts`

- [ ] **Step 1: Implement.** Key points:
  - Single module-level `Mutex` instance from `async-mutex`
  - `registerLifecyclePhaseGetter(fn)` hook so Chunk 5's lifecycle module can inject its getter without circular import
  - `ensureReady()` checks `getConfigAccessOk()` + `getter() === 'idle'`
  - Atomic write: tmp file in same dir named `.<orig>.tmp-<rand>`, fsync via `open(...).then(fh => fh.sync())`, `rename` over the original
  - Backups land in `/pz-data/Server/.backups/` (not alongside the real file). Prune to newest 10 per original file by ISO-timestamp filename sort
  - Returns typed failure codes: `config-dir-unreachable`, `config-busy`, `lifecycle-busy`, `mtime-race`, `validation`, `unknown-key`, `serialize-shape-unsupported`, `io`, `empty-patch`

Skeleton:

```ts
import { Mutex } from "async-mutex";
import { randomBytes } from "node:crypto";
import { writeFile, rename, stat, mkdir, readdir, unlink, copyFile, open } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { getConfigAccessOk } from "./access-check";
import { readServerIni, readSandboxVars } from "./config-reader";
import { parseIni } from "./parse-ini";
import { parseSandboxLua } from "./parse-sandbox-lua";
import { serializeIni } from "./serialize-ini";
import { serializeSandboxLua } from "./serialize-sandbox-lua";
import { validateIniPatch, validateSandboxPatch } from "./validate";
import { INI_DESCRIPTORS } from "./ini-descriptors";

const writeMutex = new Mutex();
let lifecyclePhaseGetter: () => string = () => "idle";
export function registerLifecyclePhaseGetter(fn: () => string): void { lifecyclePhaseGetter = fn; }

const configDir = () => process.env.PZ_CONFIG_DIR ?? "/pz-data/Server";
const backupDir = () => process.env.PZ_BACKUP_DIR ?? join(configDir(), ".backups");

export type WriteFailureCode =
  | "config-dir-unreachable" | "config-busy" | "lifecycle-busy"
  | "mtime-race" | "validation" | "unknown-key"
  | "serialize-shape-unsupported" | "io" | "empty-patch";

export type WriteOutcome =
  | { ok: true; diff: Array<{ path: string; from: unknown; to: unknown }>; newMtimeMs: number; backupPath: string }
  | { ok: false; code: WriteFailureCode; detail: string; errors?: Array<{ path: string; code: string; message: string }> };

async function ensureBackupsDir() { await mkdir(backupDir(), { recursive: true }); }

async function backup(file: string): Promise<string> {
  await ensureBackupsDir();
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(backupDir(), `${basename(file)}.bak-${iso}`);
  await copyFile(file, dest);
  const files = (await readdir(backupDir()))
    .filter((f) => f.startsWith(`${basename(file)}.bak-`))
    .sort();
  const toRemove = files.slice(0, Math.max(0, files.length - 10));
  for (const f of toRemove) {
    await unlink(join(backupDir(), f)).catch(() => {});
  }
  return dest;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = join(dirname(file), `.${basename(file)}.tmp-${randomBytes(6).toString("hex")}`);
  await writeFile(tmp, content, "utf8");
  const fh = await open(tmp, "r+");
  try { await fh.sync(); } finally { await fh.close(); }
  await rename(tmp, file);
}

function ensureReady(): WriteOutcome | null {
  if (!getConfigAccessOk()) return { ok: false, code: "config-dir-unreachable", detail: "fs.access failed" };
  const phase = lifecyclePhaseGetter();
  if (phase !== "idle") return { ok: false, code: "lifecycle-busy", detail: `phase=${phase}` };
  return null;
}

// writeServerIni(patch, { clientMtimeMs }) and writeSandboxVars(patch, { clientMtimeMs }):
//   1. If Object.keys(patch).length === 0 → empty-patch
//   2. ready = ensureReady(); if ready → return ready
//   3. acquire mutex via runExclusive; inside:
//      a. validate*Patch(patch) → on error, return validation
//      b. read current file (readServerIni / readSandboxVars); on !ok → io
//      c. if Math.floor(current.mtimeMs) !== Math.floor(opts.clientMtimeMs) → mtime-race
//      d. serialize; catch unknown-key / serialize-shape-unsupported from serializer
//      e. backup(current.path)
//      f. atomicWrite(current.path, newRaw)
//      g. compute diff vs previously parsed values; return { ok: true, diff, newMtimeMs, backupPath }
```

- [ ] **Step 2: Write unit tests** — one file per scenario. Use `mkdtemp` for an isolated FS and `vi.mock('@/lib/pz/access-check', () => ({ getConfigAccessOk: () => true, checkConfigAccess: async () => ({ ok: true, dir: '' }) }))`.

- [ ] **Step 3: Run → green.**

- [ ] **Step 4: Commit in 3 batches** for review ergonomics:

```bash
git add lib/pz/writer.ts tests/unit/pz/writer.round-trip.test.ts
git commit -m "feat(pz): writer.ts — atomic ini/sandbox write with mutex + mtime + backups"

git add tests/unit/pz/writer.backup.test.ts tests/unit/pz/writer.mtime-race.test.ts
git commit -m "test(pz): writer backup retention + mtime race"

git add tests/unit/pz/writer.config-busy.test.ts tests/unit/pz/writer.lifecycle-gate.test.ts tests/unit/pz/writer.fs-errors.test.ts
git commit -m "test(pz): writer mutex, lifecycle gate, fs errors"
```

---

## Task 3.7 — Add `AuditEvent` Prisma model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1:** Add:

```prisma
enum AuditKind {
  CONFIG_WRITE
  LIFECYCLE_START
  LIFECYCLE_STOP
  LIFECYCLE_RESTART
  LIFECYCLE_FORCE_STOP
  LIFECYCLE_ABORT
}

model AuditEvent {
  id        String    @id @default(cuid())
  userId    String
  kind      AuditKind
  detail    Json
  createdAt DateTime  @default(now())

  @@index([createdAt])
  @@index([userId, createdAt])
}
```

- [ ] **Step 2:** `pnpm prisma migrate dev --name add_audit_event` locally. In prod use `prisma db push` per Phase 1 gotcha.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add AuditEvent model"
```

---

## Task 3.8 — Host compose flip `:ro` → `:rw`

- [ ] **Step 1:** SSH to HomePL, edit `/opt/docker/pz-crcon/docker-compose.yml`: change `pz-data:/pz-data:ro` to `pz-data:/pz-data:rw`. Update mirror at `docs/deployment/pz-crcon-compose-phase1.7.yml`.

- [ ] **Step 2:** Apply:

```bash
ssh ... "cd /opt/docker/pz-crcon && docker compose up -d --force-recreate pz-crcon"
```

- [ ] **Step 3:** Verify (inside pz-crcon):

```bash
ssh ... "docker compose -f /opt/docker/pz-crcon/docker-compose.yml run --rm --no-deps --entrypoint sh pz-crcon -c 'touch /pz-data/Server/.rw-probe && rm /pz-data/Server/.rw-probe && echo RW-OK'"
```

- [ ] **Step 4: Commit mirror file**

```bash
git add docs/deployment/pz-crcon-compose-phase1.7.yml
git commit -m "docs(deploy): flip pz-data mount to rw (Chunk 3 writer goes live)"
```

---

## Task 3.9 — Chunk 3 acceptance gate

- [ ] All writer unit tests green.
- [ ] Backup pruning works (manual: spam 15 writes, verify 10 remain in `.backups/`).
- [ ] Host probe confirms RW mount.
- [ ] Config page remains read-only (Chunk 4 adds UI).
- [ ] Merge to main.
