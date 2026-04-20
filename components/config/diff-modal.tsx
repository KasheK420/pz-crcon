"use client";

/**
 * Compact diff preview shown after a successful save.
 *
 * Lists every `{ path, from, to }` row in a 3-column monospace table so
 * the operator can eyeball what just changed before the restart prompt
 * follows. Confirm just closes the modal; Cancel is a visual alias —
 * the write already landed by the time this opens. (The parent passes
 * `onCancel` when it wants to let the operator dismiss without firing
 * the restart-prompt flow.)
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

export interface DiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

interface Props {
  open: boolean;
  diff: DiffEntry[];
  title?: string;
  description?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

function formatValue(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

export function DiffModal({
  open,
  diff,
  title = "Config changed",
  description,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nowOpen) => {
        if (!nowOpen && onCancel) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="pz-display-h">{title}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto rounded-md border border-pz-border-lo">
          <table className="pz-table text-xs w-full">
            <thead>
              <tr>
                <th className="w-[40%]">Key</th>
                <th>From</th>
                <th>To</th>
              </tr>
            </thead>
            <tbody>
              {diff.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-pz-muted text-center py-3">
                    no changes
                  </td>
                </tr>
              )}
              {diff.map((d) => (
                <tr key={d.path}>
                  <td className="pz-mono text-pz-text align-top">{d.path}</td>
                  <td className="pz-mono text-pz-muted align-top break-all">
                    {formatValue(d.from)}
                  </td>
                  <td className="pz-mono text-pz-primary align-top break-all">
                    {formatValue(d.to)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Close
            </Button>
          )}
          <Button type="button" onClick={onConfirm}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
