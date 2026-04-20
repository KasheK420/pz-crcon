import { cn } from "@/lib/utils";

type Variant = "live" | "warn" | "down";

export function LiveDot({
  variant = "live",
  label,
  className,
}: {
  variant?: Variant;
  label?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn("live-dot", variant === "warn" && "warn", variant === "down" && "down")} />
      {label && (
        <span className="pz-mono text-[10.5px] tracking-[0.08em] uppercase text-pz-muted">
          {label}
        </span>
      )}
    </span>
  );
}
