"use client";

/**
 * Prompts the operator to restart the server after a config write that
 * touched a restart-gated key.
 *
 * As of Chunk 5, the "Restart now" primary button is wired into the
 * lifecycle orchestrator — call sites pass `canRestart={true}` and provide
 * an `onRestart` handler that POSTs `/api/admin/server/restart`.
 *
 * If a caller still passes `canRestart={false}` (e.g. a non-ADMIN viewing
 * a descriptor diff), the button renders disabled with a tooltip.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  open: boolean;
  /** When true (Chunk 5+), the Restart button fires `onRestart`. */
  canRestart: boolean;
  onRestart: () => void;
  onLater: () => void;
  /** Optional sub-copy — typically the list of restart-gated keys. */
  reason?: string;
}

export function RestartPromptModal({
  open,
  canRestart,
  onRestart,
  onLater,
  reason,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nowOpen) => {
        if (!nowOpen) onLater();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="pz-display-h">
            Restart required
          </DialogTitle>
          <DialogDescription>
            {reason ??
              "One or more keys you changed will only take effect after the PZ server restarts."}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onLater}>
            Later
          </Button>

          {canRestart ? (
            <Button type="button" variant="default" onClick={onRestart}>
              Restart now
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="default"
                      disabled
                      aria-disabled
                    >
                      Restart now
                    </Button>
                  }
                />
                <TooltipContent>
                  Restart is ADMIN+ only
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
