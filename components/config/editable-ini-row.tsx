"use client";

/**
 * Typed control renderer for a single INI key, driven by INI_DESCRIPTORS.
 *
 * Secret keys (RCONPassword, Password, DiscordToken) route through
 * `SecretsReveal`, which handles the OWNER-only reveal-then-edit flow.
 * Everything else behaves like `SandboxVarControl` — Switch / Slider+
 * Input / Input / Select.
 */

import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IniDescriptor } from "@/lib/pz/ini-descriptors";
import { SecretsReveal } from "./secrets-reveal";

interface Props {
  keyName: string;
  descriptor: IniDescriptor;
  /**
   * Current buffer value. For secrets, this is either `__REDACTED__`
   * (untouched) or the revealed real value. INI bools come across the
   * wire as the strings "true" / "false".
   */
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
  /** OWNER-only flag used by SecretsReveal to gate reveal UI. */
  canRevealSecrets: boolean;
  disabled?: boolean;
}

function coerceBoolFromIni(v: string | number | boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return !!v;
}

export function EditableIniRow({
  keyName,
  descriptor,
  value,
  onChange,
  canRevealSecrets,
  disabled,
}: Props) {
  if (descriptor.secret) {
    return (
      <SecretsReveal
        keyName={keyName}
        canReveal={canRevealSecrets}
        value={typeof value === "string" ? value : String(value)}
        onChange={onChange}
      />
    );
  }

  switch (descriptor.type) {
    case "bool":
      return (
        <Switch
          checked={coerceBoolFromIni(value)}
          onCheckedChange={(c) => onChange(!!c ? "true" : "false")}
          disabled={disabled}
        />
      );

    case "enum": {
      const opts = descriptor.options ?? [];
      return (
        <Select<string>
          value={String(value)}
          onValueChange={(v) => {
            if (v == null) return;
            const match = opts.find((o) => String(o.value) === v);
            if (match) onChange(match.value);
            else onChange(v);
          }}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={String(o.value)} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case "int":
    case "float": {
      const hasRange =
        descriptor.min !== undefined && descriptor.max !== undefined;
      const step = descriptor.step ?? (descriptor.type === "int" ? 1 : 0.01);
      const current = typeof value === "number" ? value : Number(value);
      const safe = Number.isFinite(current) ? current : 0;

      if (hasRange) {
        return (
          <div className="flex items-center gap-3">
            <Slider
              aria-label={keyName}
              min={descriptor.min}
              max={descriptor.max}
              step={step}
              value={safe}
              onValueChange={(n) => onChange(n)}
              disabled={disabled}
              className="flex-1"
            />
            <Input
              type="number"
              className="w-20 pz-mono"
              value={safe}
              min={descriptor.min}
              max={descriptor.max}
              step={step}
              disabled={disabled}
              onChange={(ev) => {
                const n =
                  descriptor.type === "int"
                    ? parseInt(ev.currentTarget.value, 10)
                    : parseFloat(ev.currentTarget.value);
                if (Number.isFinite(n)) onChange(n);
              }}
            />
          </div>
        );
      }

      return (
        <Input
          type="number"
          className="pz-mono"
          value={safe}
          step={step}
          disabled={disabled}
          onChange={(ev) => {
            const n =
              descriptor.type === "int"
                ? parseInt(ev.currentTarget.value, 10)
                : parseFloat(ev.currentTarget.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      );
    }

    case "csv":
    case "string":
      return (
        <Input
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(ev) => onChange(ev.currentTarget.value)}
        />
      );
  }
}
