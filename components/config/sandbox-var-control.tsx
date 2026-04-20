"use client";

/**
 * Typed control renderer for a single sandbox descriptor.
 *
 * Given a descriptor + current value + onChange, renders the matching
 * shadcn primitive (Switch / Slider+Input / Input / Select) and emits
 * the canonical value type (boolean / number / string) back to the
 * parent edit buffer.
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
import type { SandboxDescriptor } from "@/lib/pz/sandbox-descriptors";

interface Props {
  descriptor: SandboxDescriptor;
  value: boolean | number | string;
  onChange: (v: boolean | number | string) => void;
  disabled?: boolean;
}

export function SandboxVarControl({
  descriptor,
  value,
  onChange,
  disabled,
}: Props) {
  switch (descriptor.type) {
    case "bool":
      return (
        <Switch
          checked={!!value}
          onCheckedChange={(c) => onChange(!!c)}
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
      const step =
        descriptor.step ?? (descriptor.type === "int" ? 1 : 0.01);
      const current = typeof value === "number" ? value : Number(value);
      const safe = Number.isFinite(current) ? current : 0;

      if (hasRange) {
        return (
          <div className="flex items-center gap-3">
            <Slider
              aria-label={descriptor.label}
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
