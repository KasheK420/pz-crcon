"use client";

/**
 * Prompts the operator to restart the server after a config write that
 * touched a restart-gated key.
 *
 * Phase 1.7 Chunk 4: the "Restart now" primary button is rendered but
 * disabled, with a tooltip explaining why. Chunk 5 lands the lifecycle
 * module and flips `canRestart` on. Until then, operators restart via
 * SSH — the "Later" button just dismisses the prompt.
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
                  Lifecycle ships in Phase 1.7 Chunk 5
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
