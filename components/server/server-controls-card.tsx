"use client";

/**
 * `ServerControlsCard` — the dashboard widget for driving the PZ server
 * lifecycle. Renders Start / Stop / Restart / Force-stop buttons plus an
 * Abort button that appears during non-idle phases (except `starting`,
 * which cannot be aborted safely).
 *
 * - Buttons are enabled only when the phase + container state make the
 *   action meaningful (e.g. Start is disabled while already running).
 * - Proxy unreachable disables everything and surfaces a banner.
 * - Force-stop opens a confirm dialog requiring the literal string
 *   `FORCE-STOP` to be typed before the POST goes out.
 * - Every call uses `csrfFetch` and toasts the outcome.
 */

import { useCallback, useEffect, useState } from "react";
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
import { atLeast, type Role } from "@/lib/auth/role";
import {
  LifecyclePhaseBadge,
  type LifecycleSnapshot,
} from "@/components/server/lifecycle-phase-badge";

interface ServerState {
  containerState: "running" | "exited" | "unknown";
  rconOnline: boolean;
  proxyReachable: boolean;
  lifecyclePhase: LifecycleSnapshot["phase"];
}

interface Props {
  role: Role;
}

type PendingAction = "start" | "stop" | "restart" | "force-stop" | "abort" | null;

async function callEndpoint(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: { code?: string; detail?: string } }> {
  const res = await csrfFetch(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: { code?: string; detail?: string } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    // ignore
  }
  return { ok: res.ok, status: res.status, json };
}

function toastResult(
  label: string,
  res: { ok: boolean; status: number; json: { code?: string; detail?: string } },
) {
  if (res.ok) {
    toast.success(`${label} complete`);
    return;
  }
  if (res.status === 409 && res.json.code === "lifecycle-busy") {
    toast.error(`${label}: Lifecycle busy — another operation is in progress.`);
    return;
  }
  if (res.status === 503 && res.json.code === "proxy-unreachable") {
    toast.error(`${label}: Proxy unreachable — check docker-socket-proxy.`);
    return;
  }
  toast.error(
    `${label} failed (${res.status}${res.json.code ? ` · ${res.json.code}` : ""})`,
  );
}

export function ServerControlsCard({ role }: Props) {
  const [snap, setSnap] = useState<LifecycleSnapshot>({ phase: "idle" });
  const [state, setState] = useState<ServerState | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [forceOpen, setForceOpen] = useState(false);
  const [forceInput, setForceInput] = useState("");

  const isAdmin = atLeast(role, "ADMIN");
  const isOwner = atLeast(role, "OWNER");

  // Poll state every 10s for container/proxy reachability.
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch("/api/admin/server/state", {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled || !j.ok) return;
        setState({
          containerState: j.containerState,
          rconOnline: j.rconOnline,
          proxyReachable: j.proxyReachable,
          lifecyclePhase: j.lifecyclePhase,
        });
      } catch {
        // ignore
      }
    }
    void pull();
    const id = window.setInterval(pull, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const onPhase = useCallback((s: LifecycleSnapshot) => {
    setSnap(s);
    setState((prev) => (prev ? { ...prev, lifecyclePhase: s.phase } : prev));
  }, []);

  const proxyOk = state?.proxyReachable ?? true;
  const phase = snap.phase;
  const busy = phase !== "idle" || pending !== null;

  const canStart =
    proxyOk && isAdmin && !busy && state?.containerState !== "running";
  const canStop =
    proxyOk && isAdmin && !busy && state?.containerState === "running";
  const canRestart =
    proxyOk && isAdmin && !busy && state?.containerState === "running";
  const canForceStop = proxyOk && isOwner && !busy;
  const abortInFlight: boolean = pending === "abort";
  const canAbort =
    isAdmin && phase !== "idle" && phase !== "starting" && !abortInFlight;

  async function doStart() {
    setPending("start");
    try {
      const res = await callEndpoint("/api/admin/server/start");
      toastResult("Start", res);
    } finally {
      setPending(null);
    }
  }
  async function doStop() {
    setPending("stop");
    try {
      const res = await callEndpoint("/api/admin/server/stop");
      toastResult("Stop", res);
    } finally {
      setPending(null);
    }
  }
  async function doRestart() {
    setPending("restart");
    try {
      const res = await callEndpoint("/api/admin/server/restart");
      toastResult("Restart", res);
    } finally {
      setPending(null);
    }
  }
  async function doForceStop() {
    setPending("force-stop");
    try {
      const res = await callEndpoint("/api/admin/server/force-stop", {
        confirm: "FORCE-STOP",
      });
      toastResult("Force stop", res);
    } finally {
      setPending(null);
      setForceOpen(false);
      setForceInput("");
    }
  }
  async function doAbort() {
    setPending("abort");
    try {
      const res = await callEndpoint("/api/admin/server/abort");
      if (res.ok) toast.success("Abort requested.");
      else toastResult("Abort", res);
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <Panel
        title="Server Controls"
        sub="LIFECYCLE"
        right={<LifecyclePhaseBadge onSnapshot={onPhase} />}
      >
        {!proxyOk && (
          <div className="mb-2 rounded border border-pz-danger/40 bg-pz-danger/10 px-2 py-1.5 pz-mono text-[10.5px] text-pz-danger">
            Proxy unreachable — controls disabled. Check docker-socket-proxy.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={doStart}
            disabled={!canStart}
          >
            {pending === "start" ? "..." : "Start"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={doStop}
            disabled={!canStop}
          >
            {pending === "stop" ? "..." : "Stop"}
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={doRestart}
            disabled={!canRestart}
          >
            {pending === "restart" ? "..." : "Restart"}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setForceOpen(true)}
            disabled={!canForceStop}
            title={isOwner ? "Hard-kill the container" : "OWNER only"}
          >
            Force stop
          </Button>

          {canAbort && (
            <Button
              size="sm"
              variant="outline"
              onClick={doAbort}
              disabled={abortInFlight}
              className="ml-auto"
            >
              {abortInFlight ? "..." : "Abort"}
            </Button>
          )}
        </div>

        <div className="mt-2 pz-mono text-[10.5px] text-pz-text-dim">
          container:{" "}
          <span className="text-pz-text">
            {state?.containerState ?? "…"}
          </span>
          {" · "}
          rcon:{" "}
          <span className={state?.rconOnline ? "text-pz-ok" : "text-pz-muted"}>
            {state?.rconOnline ? "online" : "offline"}
          </span>
        </div>
      </Panel>

      <Dialog
        open={forceOpen}
        onOpenChange={(v) => {
          if (!v) {
            setForceOpen(false);
            setForceInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force stop</DialogTitle>
            <DialogDescription>
              This issues <code>docker kill</code> on the PZ container — no
              RCON save, no warning in-game. Players may lose a few minutes
              of progress. Type <code>FORCE-STOP</code> below to confirm.
            </DialogDescription>
          </DialogHeader>
          <input
            value={forceInput}
            onChange={(e) => setForceInput(e.target.value)}
            placeholder="FORCE-STOP"
            autoFocus
            className="w-full bg-pz-bg-0 border border-pz-border-lo px-2 py-1.5 pz-mono text-xs text-pz-text focus:outline-none focus:border-pz-border-hi"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setForceOpen(false);
                setForceInput("");
              }}
              disabled={pending === "force-stop"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={doForceStop}
              disabled={forceInput !== "FORCE-STOP" || pending === "force-stop"}
            >
              {pending === "force-stop" ? "..." : "Force stop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
