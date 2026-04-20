"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { atLeast, type Role } from "@/lib/auth/role";
import type { PlayerRow } from "./types";

type ActionKind = "kick" | "ban" | "unban" | "profile" | null;

export function PlayerRowActions({
  player,
  role,
  onRefresh,
}: {
  player: PlayerRow;
  role: Role;
  onRefresh: () => void;
}) {
  const [action, setAction] = useState<ActionKind>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  async function runAction(kind: "kick" | "ban" | "unban") {
    setPending(true);
    try {
      const res = await fetch(`/api/players/${player.id}/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "unban" ? {} : { reason }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(`${kind} failed: ${j.error ?? res.status}`);
        return;
      }
      toast.success(
        kind === "kick"
          ? `Kicked ${player.name}`
          : kind === "ban"
            ? `Banned ${player.name}`
            : `Unbanned ${player.name}`
      );
      setAction(null);
      setReason("");
      onRefresh();
    } catch (e) {
      toast.error(`${kind} failed: ${String(e)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm">
              <MoreVertical />
              <span className="sr-only">Open actions</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setAction("profile")}>
            View profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setAction("kick")}
            disabled={!atLeast(role, "MODERATOR") || !player.isOnline}
          >
            Kick
          </DropdownMenuItem>
          {player.isBanned ? (
            <DropdownMenuItem
              onClick={() => runAction("unban")}
              disabled={!atLeast(role, "ADMIN")}
            >
              Un-ban
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setAction("ban")}
              disabled={!atLeast(role, "ADMIN")}
            >
              Ban
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Profile modal */}
      <Dialog
        open={action === "profile"}
        onOpenChange={(v) => !v && setAction(null)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{player.name} · Survivor Profile</DialogTitle>
            <DialogDescription>
              Persistent player data. Survival graph arrives in Phase 2.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-xs pz-mono">
            <ProfileField label="Steam ID" value={player.steamId} />
            <ProfileField label="Status" value={player.isOnline ? "online" : "offline"} />
            <ProfileField label="Banned" value={player.isBanned ? "yes" : "no"} />
            <ProfileField label="Deaths" value={String(player.deaths)} />
            <ProfileField
              label="First seen"
              value={new Date(player.firstSeen).toLocaleString()}
            />
            <ProfileField
              label="Last seen"
              value={new Date(player.lastSeen).toLocaleString()}
            />
            <ProfileField
              label="Playtime"
              value={`${Math.floor(player.totalPlaytime / 60)}m`}
            />
            <ProfileField
              label="Whitelisted"
              value={player.isWhitelisted ? "yes" : "no"}
            />
            <ProfileField label="Country" value={player.countryLast ?? "—"} />
            <ProfileField label="Region" value={player.lastRegion ?? "—"} />
            {player.banReason && (
              <div className="col-span-2 mt-2">
                <div className="pz-label">BAN REASON</div>
                <div className="pz-mono text-pz-text-dim">{player.banReason}</div>
              </div>
            )}
            {player.notes && (
              <div className="col-span-2">
                <div className="pz-label">NOTES</div>
                <div className="text-pz-text-dim font-sans">{player.notes}</div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Reason prompt for kick/ban */}
      <Dialog
        open={action === "kick" || action === "ban"}
        onOpenChange={(v) => {
          if (!v) {
            setAction(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "kick" ? "Kick" : "Ban"} {player.name}?
            </DialogTitle>
            <DialogDescription>
              {action === "kick"
                ? "This disconnects the player. They can rejoin."
                : "This prevents the player from rejoining until unbanned."}
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="pz-label">REASON (optional)</label>
            <input
              className="mt-1 w-full bg-pz-bg-0 border border-pz-border-lo px-2 py-1.5 pz-mono text-xs text-pz-text focus:outline-none focus:border-pz-border-hi"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. griefing, AFK, restart..."
              autoFocus
              maxLength={200}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAction(null);
                setReason("");
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant={action === "ban" ? "destructive" : "default"}
              onClick={() => action && runAction(action as "kick" | "ban")}
              disabled={pending}
            >
              {pending ? "..." : action === "ban" ? "Ban" : "Kick"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="pz-label">{label}</span>
      <span className="text-pz-text-dim break-all">{value}</span>
    </div>
  );
}
