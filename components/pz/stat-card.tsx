import * as React from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  unit,
  foot,
  variant = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  foot?: React.ReactNode;
  variant?: "default" | "ok" | "warn" | "danger";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pz-stat",
        variant === "ok" && "ok",
        variant === "warn" && "warn",
        variant === "danger" && "danger",
        className
      )}
    >
      <div className="pz-label">{label}</div>
      <div className="v">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}
