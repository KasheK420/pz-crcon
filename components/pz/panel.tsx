import * as React from "react";
import { cn } from "@/lib/utils";

interface PanelProps extends Omit<React.ComponentProps<"div">, "title"> {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  dense?: boolean;
  bodyClassName?: string;
}

export function Panel({
  title,
  sub,
  right,
  dense,
  bodyClassName,
  className,
  children,
  ...props
}: PanelProps) {
  return (
    <div className={cn("pz-panel", className)} {...props}>
      {(title || right) && (
        <div className="pz-panel-head">
          {title && <div className="pz-panel-title">{title}</div>}
          {sub && <div className="pz-panel-sub">{sub}</div>}
          {right && <div className="ml-auto">{right}</div>}
        </div>
      )}
      <div className={cn("pz-panel-body", dense && "dense", bodyClassName)}>
        {children}
      </div>
    </div>
  );
}
