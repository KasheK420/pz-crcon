"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const STEAM_ID_RE = /^7656119\d{10}$/;

interface Props {
  onAdded: () => void;
}

export function AddSteamIdForm({ onAdded }: Props) {
  const [steamId, setSteamId] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);

  const valid = STEAM_ID_RE.test(steamId.trim());

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/whitelist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          steamId: steamId.trim(),
          notes: notes.trim() || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Add failed: ${j.details ?? j.error ?? res.status}`);
        return;
      }
      toast.success(`Whitelisted ${steamId.trim()}`);
      setSteamId("");
      setNotes("");
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
        <label className="pz-label w-[80px]">STEAM ID</label>
        <input
          value={steamId}
          onChange={(e) => setSteamId(e.target.value)}
          placeholder="76561198xxxxxxxxx"
          maxLength={32}
          className="flex-1 min-w-[260px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
        />
        {steamId.length > 0 && !valid && (
          <span className="pz-mono text-[10.5px] text-pz-danger">invalid SteamID64</span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="pz-label w-[80px]">NOTES</label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="optional, e.g. 'invited by Honza in #lobby'"
          maxLength={500}
          className="flex-1 min-w-[260px] bg-pz-bg-0 border border-pz-border-lo px-2 py-1 pz-mono text-xs text-pz-text placeholder:text-pz-muted focus:outline-none focus:border-pz-border-hi"
        />
        <Button type="submit" size="sm" disabled={!valid || pending}>
          {pending ? "..." : "ADD"}
        </Button>
      </div>
    </form>
  );
}
