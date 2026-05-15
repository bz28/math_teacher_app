"use client";

import {
  forwardRef,
  type ReactNode,
  type MouseEventHandler,
} from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  className?: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

// Hairline-first button system — ink primary, outlined secondary, quiet
// ghost, restrained danger. No shadow chrome, no ripple, no gradient.
// Matches the dashboard's restraint; the green primary is the only
// chromatic moment on a button surface.
const variantStyles: Record<Variant, string> = {
  primary:
    "bg-primary text-text-on-primary hover:bg-primary-dark active:bg-primary-dark",
  secondary:
    "bg-transparent text-text-primary border border-border hover:border-text-primary",
  ghost:
    "bg-transparent text-text-secondary hover:bg-surface-alt hover:text-text-primary",
  danger:
    "bg-error text-white hover:bg-error/90",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-9 px-4 text-sm rounded-[--radius-sm]",
  md: "h-11 px-6 text-[15px] rounded-[--radius-sm]",
  lg: "h-13 px-8 text-base rounded-[--radius-sm]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      className,
      disabled,
      children,
      type = "button",
      onClick,
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref}
        type={type}
        whileTap={isDisabled ? undefined : { scale: 0.98 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-semibold tracking-[0.01em] transition-colors cursor-pointer",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        disabled={isDisabled}
        onClick={onClick}
      >
        {loading && <Spinner />}
        {children}
      </motion.button>
    );
  },
);
Button.displayName = "Button";

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
