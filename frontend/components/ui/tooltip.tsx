"use client";

import * as React from "react";
import type { CSSProperties, ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

/**
 * shadcn-style wrapper around @radix-ui/react-tooltip, styled with the Groville
 * design tokens (see `.gv-tooltip` in app/globals.css — flat solid surface, no
 * glass). Accessible and keyboard-focusable out of the box: Radix wires
 * aria-describedby, focus/blur, and Escape-to-dismiss.
 *
 * `InfoTip` is the convenience used across the dashboards: it wraps any inline
 * element (a badge, chip, or label) in a focusable trigger so the same tooltip
 * works on hover and via keyboard. Content is portaled to <body>, so it renders
 * above the flat dashboard surfaces regardless of local stacking contexts.
 */

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={"gv-tooltip" + (className ? " " + className : "")}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="gv-tooltip-arrow" width={11} height={5} />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/**
 * Wrap an inline element so it shows `tip` on hover and keyboard focus. The
 * trigger span is focusable (`tabIndex={0}`) and picks up the global
 * focus-visible ring. Default display is inline so wrapping text is unaffected.
 */
function InfoTip({
  tip,
  children,
  side = "top",
  style,
}: {
  tip: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Merge onto the trigger span (e.g. `display: "inline-flex"` for a badge). */
  style?: CSSProperties;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} style={{ cursor: "help", ...style }}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side={side}>{tip}</TooltipContent>
    </Tooltip>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, InfoTip };
