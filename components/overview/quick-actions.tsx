"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/pz/panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { atLeast, type Role } from "@/lib/auth/role";

type Action = "save" | "servermsg" | "kickall" | null;

export function QuickActions({ role }: { role: Role }) {
  const [open, setOpen] = useState<Action>(null);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  async function run(payload: Record<string, unknown>) {
    setPending(true);
    try {
      const res = await fetch("/api/admin/quick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Failed: ${j.error ?? res.status}`);
        return;
      }
      toast.success("Action dispatched.");
      setOpen(null);
      setMessage("");
      setReason("");
    } catch (e) {
      toast.error(`Failed: ${String(e)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Panel title="Quick Actions" sub="ONE-CLICK">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen("servermsg")}
            disabled={!atLeast(role, "MODERATOR")}
          >
            Broadcast
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen("save")}
            disabled={!atLeast(role, "ADMIN")}
          >
            Save world
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setOpen("kickall")}
            disabled={!atLeast(role, "ADMIN")}
          >
            Kick all
          </Button>
        </div>
      </Panel>

      <Dialog open={open === "save"} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save world?</DialogTitle>
            <DialogDescription>
              Issues `save` over RCON. Brief stutter expected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={() => run({ action: "save" })}
              disabled={pending}
            >
              {pending ? "..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={open === "servermsg"}
        onOpenChange={(v) => !v && setOpen(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Broadcast message</DialogTitle>
            <DialogDescription>
              Sends a message to every connected player.
            </DialogDescription>
          </DialogHeader>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Restart in 15 minutes"
            className="w-full bg-pz-bg-0 border border-pz-border-lo px-2 py-1.5 pz-mono text-xs text-pz-text focus:outline-none focus:border-pz-border-hi"
            autoFocus
            maxLength={200}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={() => run({ action: "servermsg", message })}
              disabled={pending || !message.trim()}
            >
              {pending ? "..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={open === "kickall"}
        onOpenChange={(v) => !v && setOpen(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kick all players?</DialogTitle>
            <DialogDescription>
              Disconnects everyone currently online. They can rejoin.
            </DialogDescription>
          </DialogHeader>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="reason (optional)"
            className="w-full bg-pz-bg-0 border border-pz-border-lo px-2 py-1.5 pz-mono text-xs text-pz-text focus:outline-none focus:border-pz-border-hi"
            maxLength={200}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => run({ action: "kickall", reason })}
              disabled={pending}
            >
              {pending ? "..." : "Kick all"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
