"use client";

import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ className, align = "start", sideOffset = 6, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          "z-50 max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
