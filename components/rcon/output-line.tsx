import { cn } from "@/lib/utils";

export type OutputKind = "user" | "ok" | "info" | "warn" | "error";

export interface OutputEntry {
  kind: OutputKind;
  text: string;
  ts?: number;
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

export function OutputLine({ entry }: { entry: OutputEntry }) {
  return (
    <div className={cn("pz-terminal-line", entry.kind)}>
      {entry.ts && (
        <span className="text-pz-muted mr-2">[{formatTs(entry.ts)}]</span>
      )}
      <span>{entry.text}</span>
    </div>
  );
}
