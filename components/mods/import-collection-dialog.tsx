"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { csrfFetch } from "@/lib/csrf/fetch";

interface Props {
  onImported: () => void;
}

/**
 * Click to open a lightweight prompt that imports a Steam Workshop
 * *collection* — replacing the current list if `replaceExisting` is
 * checked, otherwise appending new rows. Uses `window.prompt` / inline
 * div instead of the full Dialog primitive so it works without extra
 * base-ui state plumbing and renders inside the sticky header row.
 */
export function ImportCollectionDialog({ onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [pending, setPending] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!value.trim() || pending) return;
    if (
      replaceExisting &&
      !confirm(
        "Replace the ENTIRE existing mod list with this collection?\n\nAll current mod rows will be deleted first. The WorkshopItems= and Mods= lines in server.ini will be overwritten. This cannot be undone (except by manually re-adding).\n\nContinue?",
      )
    ) {
      return;
    }
    setPending(true);
    try {
      const res = await csrfFetch("/api/admin/mods/import", {
        method: "POST",
        body: JSON.stringify({
          collectionId: value.trim(),
          replaceExisting,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Import failed: ${j.detail ?? j.code ?? res.status}`);
        return;
      }
      const msg = `Imported ${j.addedCount} new mod(s)${
        j.skippedCount ? `, skipped ${j.skippedCount} duplicate(s)` : ""
      }${j.steamMisses?.length ? `, ${j.steamMisses.length} missed Steam lookup` : ""}${
        j.iniApplied ? " — INI updated (requires restart)" : ""
      }.`;
      toast.success(msg);
      setOpen(false);
      setValue("");
      onImported();
    } catch (e) {
      toast.error(`Import failed: ${String(e)}`);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        type="button"
      >
        Import collection
      </Button>
    );
  }

  return (
    <div className="w-full flex flex-col gap-2 p-3 bg-pz-bg-1 border border-pz-border-lo">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="pz-label w-[110px]">COLLECTION</label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="3713221548  or  https://steamcommunity.com/sharedfiles/filedetails/?id=3713221548"
            maxLength={300}
            className="flex-1 min-w-[320px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
            autoFocus
          />
        </div>
        <label className="flex items-center gap-2 pz-mono text-[11px] text-pz-muted cursor-pointer">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(e) => setReplaceExisting(e.target.checked)}
            className="accent-pz-primary"
          />
          Replace existing mod list (delete all current rows first)
        </label>
        <div className="flex gap-2 justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              setValue("");
            }}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!value.trim() || pending}>
            {pending ? "Importing…" : "IMPORT"}
          </Button>
        </div>
      </form>
    </div>
  );
}
