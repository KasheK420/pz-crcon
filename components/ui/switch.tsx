"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props & { className?: string }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-pz-border-lo bg-pz-bg-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-pz-primary/60 disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-pz-primary data-[checked]:border-pz-primary-dim",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block h-4 w-4 translate-x-0.5 rounded-full bg-pz-text shadow-sm transition-transform data-[checked]:translate-x-[18px]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
