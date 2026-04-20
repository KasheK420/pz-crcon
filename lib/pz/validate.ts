/**
 * Per-descriptor Zod validators for sandbox and INI patches.
 *
 * The descriptor metadata (type / min / max / options) drives schema
 * construction so validation rules never drift from the UI hints.
 *
 * Returns a structured `ValidationResult` that the writer maps to a
 * `validation` failure code when rejecting a patch.
 */
import { z } from "zod";
import { describeSandbox, type SandboxDescriptor } from "./sandbox-descriptors";
import { INI_DESCRIPTORS, type IniDescriptor } from "./ini-descriptors";

export type ValidationCode = "unknown-key" | "type" | "range" | "enum";

export interface ValidationError {
  path: string;
  code: ValidationCode;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors?: ValidationError[];
}

// ---------- Sandbox ----------

function schemaForSandbox(d: SandboxDescriptor): z.ZodTypeAny {
  switch (d.type) {
    case "bool":
      return z.boolean();
    case "int": {
      let s: z.ZodNumber = z.number().int();
      if (d.min !== undefined) s = s.min(d.min);
      if (d.max !== undefined) s = s.max(d.max);
      return s;
    }
    case "float": {
      let s: z.ZodNumber = z.number();
      if (d.min !== undefined) s = s.min(d.min);
      if (d.max !== undefined) s = s.max(d.max);
      return s;
    }
    case "enum": {
      const opts = d.options ?? [];
      const allowed = opts.map((o) => o.value);
      return z
        .union([z.number(), z.string()])
        .refine((v) => allowed.includes(v as number | string), {
          message: `expected one of: ${allowed.join(", ")}`,
        });
    }
    case "string":
      return z.string();
  }
}

function mapZodCode(first: z.core.$ZodIssue | undefined, fallback: ValidationCode): ValidationCode {
  if (!first) return fallback;
  switch (first.code) {
    case "too_small":
    case "too_big":
      return "range";
    case "invalid_type":
      return "type";
    case "custom":
      return fallback === "enum" ? "enum" : fallback;
    default:
      return fallback;
  }
}

export function validateSandboxPatch(patch: Record<string, unknown>): ValidationResult {
  const errors: ValidationError[] = [];
  for (const [path, raw] of Object.entries(patch)) {
    const d = describeSandbox(path);
    if (!d) {
      errors.push({
        path,
        code: "unknown-key",
        message: `no descriptor for ${path}`,
      });
      continue;
    }
    const schema = schemaForSandbox(d);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const fallback: ValidationCode = d.type === "enum" ? "enum" : "type";
      errors.push({
        path,
        code: mapZodCode(first, fallback),
        message: first?.message ?? "invalid value",
      });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---------- INI ----------

function schemaForIni(d: IniDescriptor): z.ZodTypeAny {
  switch (d.type) {
    case "bool": {
      // server.ini bool keys are serialized as the literal strings
      // "true"/"false". Accept either a JS boolean or one of those strings.
      return z.union([z.boolean(), z.enum(["true", "false"])]);
    }
    case "int": {
      let s: z.ZodNumber = z.number().int();
      if (d.min !== undefined) s = s.min(d.min);
      if (d.max !== undefined) s = s.max(d.max);
      return s;
    }
    case "float": {
      let s: z.ZodNumber = z.number();
      if (d.min !== undefined) s = s.min(d.min);
      if (d.max !== undefined) s = s.max(d.max);
      return s;
    }
    case "enum": {
      const opts = d.options ?? [];
      const allowed = opts.map((o) => o.value);
      return z
        .union([z.number(), z.string()])
        .refine((v) => allowed.includes(v as number | string), {
          message: `expected one of: ${allowed.join(", ")}`,
        });
    }
    case "csv":
    case "string":
      return z.string();
  }
}

export function validateIniPatch(patch: Record<string, unknown>): ValidationResult {
  const errors: ValidationError[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    const d = INI_DESCRIPTORS[key];
    if (!d) {
      errors.push({
        path: key,
        code: "unknown-key",
        message: `no descriptor for ${key}`,
      });
      continue;
    }
    const schema = schemaForIni(d);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const fallback: ValidationCode = d.type === "enum" ? "enum" : "type";
      errors.push({
        path: key,
        code: mapZodCode(first, fallback),
        message: first?.message ?? "invalid value",
      });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
