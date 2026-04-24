"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { csrfFetch } from "@/lib/csrf/fetch";

interface Props {
  onAdded: () => void;
}

/**
 * Accepts either a Workshop numeric ID or a full Workshop URL. The server
 * extracts the numeric ID so we don't bother client-side validating beyond
 * "something was typed" — the Steam API is authoritative.
 */
export function AddModForm({ onAdded }: Props) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [autoApply, setAutoApply] = useState(true);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!value.trim() || pending) return;
    setPending(true);
    try {
      const res = await csrfFetch("/api/admin/mods", {
        method: "POST",
        body: JSON.stringify({
          workshopRef: value.trim(),
          applyToIni: autoApply,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = j.detail ?? j.code ?? res.status;
        toast.error(`Add failed: ${detail}`);
        return;
      }
      toast.success(
        `Added ${j.mod?.name ?? value}${
          j.iniApplied ? " — INI updated (requires restart)" : " — INI not synced yet"
        }`,
      );
      setValue("");
      onAdded();
    } catch (e) {
      toast.error(`Add failed: ${String(e)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 p-3 bg-pz-bg-1 border border-pz-border-lo"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <label className="pz-label w-[110px]">WORKSHOP</label>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="3508537032  or  https://steamcommunity.com/sharedfiles/filedetails/?id=..."
          maxLength={300}
          className="flex-1 min-w-[320px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
        />
        <Button type="submit" size="sm" disabled={!value.trim() || pending}>
          {pending ? "..." : "ADD"}
        </Button>
      </div>
      <label className="flex items-center gap-2 pz-mono text-[11px] text-pz-muted cursor-pointer">
        <input
          type="checkbox"
          checked={autoApply}
          onChange={(e) => setAutoApply(e.target.checked)}
          className="accent-pz-primary"
        />
        Apply to server.ini immediately (still needs a server restart to load)
      </label>
    </form>
  );
}
