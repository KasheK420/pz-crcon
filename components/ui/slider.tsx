"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "@/lib/utils";

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  onValueChange?: (value: number) => void;
  onValueCommit?: (value: number) => void;
  "aria-label"?: string;
}

function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  className,
  onValueChange,
  onValueCommit,
  "aria-label": ariaLabel,
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => {
        if (typeof v === "number") onValueChange?.(v);
      }}
      onValueCommitted={(v) => {
        if (typeof v === "number") onValueCommit?.(v);
      }}
      className={cn("relative flex w-full items-center select-none", className)}
    >
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="relative flex h-5 w-full items-center"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-[3px] w-full rounded-full bg-pz-bg-2"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="absolute h-full rounded-full bg-pz-primary"
          />
          <SliderPrimitive.Thumb
            aria-label={ariaLabel}
            data-slot="slider-thumb"
            className="block h-3.5 w-3.5 rounded-full border border-pz-primary-dim bg-pz-primary shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-pz-primary/50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
