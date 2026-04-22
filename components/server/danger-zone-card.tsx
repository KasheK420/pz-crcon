"use client";

/**
 * `DangerZoneCard` — OWNER-only world-reset controls.
 *
 * Renders two destructive actions on the config page:
 *   1. "Wipe world"       — delete `Saves/Multiplayer/<prefix>/`
 *                           while keeping server config + whitelist DB.
 *   2. "Total nuke"       — also delete `Saves/` and `<prefix>.db`.
 *
 * Both flow through `POST /api/admin/server/reset-world`, which takes
 * care of the lifecycle dance (warning → stop → wipe → start). The UI
 * simply fires the request and toasts progress via the WS phase badge
 * already rendered on the page.
 *
 * Confirmation UX follows the GitHub "delete repository" pattern: the
 * OWNER must type the server prefix into a textbox before the submit
 * button enables. This is deliberately slower than a single "Confirm"
 * click — when you're about to rename a directory containing months of
 * gameplay, friction is a feature.
 */

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
import { csrfFetch } from "@/lib/csrf/fetch";
import type { Role } from "@/lib/auth/role";

type Mode = "world" | "total-nuke";

interface Props {
  role: Role;
  /**
   * Detected server prefix (e.g. "MajorlukPZ"). The user must type
   * this string exactly to enable the destructive submit. Passed in
   * from the server component so we don't need an extra round-trip.
   * When `null`, the card explains the prefix couldn't be detected
   * and disables all actions.
   */
  prefix: string | null;
}

interface ConfirmState {
  mode: Mode;
  typed: string;
}

const MODE_COPY: Record<
  Mode,
  { title: string; short: string; danger: string; button: string }
> = {
  world: {
    title: "Wipe world",
    short: "Delete the current map save. Keep config and user accounts.",
    danger:
      "This trashes Saves/Multiplayer/<prefix>/ — every explored chunk, every built safehouse, every player character. Config and whitelist survive. Trash is renamed in place (recoverable by ops until pruned after 3 wipes).",
    button: "Wipe world",
  },
  "total-nuke": {
    title: "Total nuke",
    short: "Delete world AND wipe whitelist/admin DB.",
    danger:
      "This trashes the entire Saves/ tree and the user DB (<prefix>.db). You will need to grantadmin yourself again after restart. Only server config (.ini, _SandboxVars.lua) survives.",
    button: "Nuke everything",
  },
};

export function DangerZoneCard({ role, prefix }: Props) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [pending, setPending] = useState(false);

  if (role !== "OWNER") return null;

  const close = () => {
    if (pending) return;
    setConfirm(null);
  };

  const confirmReady = Boolean(
    confirm && prefix && confirm.typed === prefix && !pending,
  );

  async function submit() {
    if (!confirm || !prefix) return;
    const copy = MODE_COPY[confirm.mode];
    setPending(true);
    try {
      const res = await csrfFetch("/api/admin/server/reset-world", {
        method: "POST",
        body: JSON.stringify({ mode: confirm.mode, confirmPrefix: prefix }),
      });
      const json: { ok?: boolean; code?: string; detail?: string } = await res
        .json()
        .catch(() => ({}));
      if (res.ok && json.ok) {
        toast.success(`${copy.title} complete — PZ is restarting.`);
        setConfirm(null);
      } else if (res.status === 409) {
        toast.error(`${copy.title}: lifecycle busy — wait and retry.`);
      } else if (res.status === 503) {
        toast.error(`${copy.title}: docker proxy unreachable.`);
      } else {
        toast.error(
          `${copy.title} failed (${res.status}${json.code ? ` · ${json.code}` : ""}${json.detail ? `: ${json.detail}` : ""})`,
        );
      }
    } catch (e) {
      toast.error(
        `${MODE_COPY[confirm.mode].title} network error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Panel title="Danger Zone" sub="OWNER ONLY">
        {!prefix && (
          <div className="mb-2 rounded border border-pz-danger/40 bg-pz-danger/10 px-2 py-1.5 pz-mono text-[10.5px] text-pz-danger">
            Server prefix not detected — controls disabled. The backend
            couldn&apos;t read <code>SERVERNAME</code> from the PZ
            container.
          </div>
        )}
        <div className="flex flex-col gap-2">
          {(Object.keys(MODE_COPY) as Mode[]).map((m) => (
            <div
              key={m}
              className="flex items-start justify-between gap-3 border border-pz-border-lo bg-pz-bg-0 p-2"
            >
              <div className="flex flex-col gap-1 text-[11.5px]">
                <div className="pz-display-h text-pz-text">
                  {MODE_COPY[m].title}
                </div>
                <div className="text-pz-text-dim">{MODE_COPY[m].short}</div>
              </div>
              <Button
                size="sm"
                variant="destructive"
                disabled={!prefix || pending}
                onClick={() => setConfirm({ mode: m, typed: "" })}
              >
                {MODE_COPY[m].button}
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-2 pz-mono text-[10.5px] text-pz-text-dim">
          prefix:{" "}
          <span className={prefix ? "text-pz-text" : "text-pz-danger"}>
            {prefix ?? "unknown"}
          </span>
        </div>
      </Panel>

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          {confirm && prefix ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-pz-danger">
                  {MODE_COPY[confirm.mode].title} — irreversible
                </DialogTitle>
                <DialogDescription className="whitespace-pre-wrap">
                  {MODE_COPY[confirm.mode].danger}
                  {"\n\n"}
                  Type <code className="pz-mono text-pz-text">{prefix}</code>{" "}
                  to confirm. The server will warn players for 30s, then stop,
                  wipe, and restart automatically.
                </DialogDescription>
              </DialogHeader>
              <input
                value={confirm.typed}
                onChange={(e) =>
                  setConfirm({ ...confirm, typed: e.target.value })
                }
                placeholder={prefix}
                autoFocus
                disabled={pending}
                className="w-full bg-pz-bg-0 border border-pz-border-lo px-2 py-1.5 pz-mono text-xs text-pz-text focus:outline-none focus:border-pz-danger"
              />
              <DialogFooter>
                <Button variant="outline" onClick={close} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={submit}
                  disabled={!confirmReady}
                >
                  {pending ? "..." : MODE_COPY[confirm.mode].button}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
