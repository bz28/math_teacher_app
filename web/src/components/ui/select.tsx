"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "./icons";

// Editorial select — mirrors the Input chrome exactly (h-11, hairline border,
// surface bg, accent border on focus), but strips the raw OS dropdown triangle
// (appearance-none) and draws our own muted chevron. The one common control
// that was previously falling back to native browser chrome on a deliberate
// editorial surface.

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className, id, children, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="text-[12px] font-semibold uppercase tracking-[0.12em] text-text-secondary"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              "h-11 w-full appearance-none rounded-[--radius-sm] border border-border bg-surface pl-3 pr-9 text-[15px] text-text-primary",
              "transition-colors focus:border-primary focus:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-error focus:border-error",
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        </div>
        {error && <p className="text-xs font-medium text-error">{error}</p>}
      </div>
    );
  },
);
Select.displayName = "Select";
