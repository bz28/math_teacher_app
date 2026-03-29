"use client";

import { forwardRef, type ReactNode, type MouseEventHandler } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  gradient?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  className?: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-primary text-text-on-primary hover:bg-primary-dark shadow-sm active:shadow-none",
  secondary:
    "bg-primary-bg text-primary border border-primary/20 hover:bg-primary/10",
  ghost: "text-text-secondary hover:bg-primary-bg hover:text-primary",
  danger: "bg-error text-white hover:bg-error/90",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-9 px-4 text-sm rounded-[--radius-sm]",
  md: "h-11 px-6 text-base rounded-[--radius-md]",
  lg: "h-13 px-8 text-base rounded-[--radius-lg]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      gradient = false,
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
        whileTap={isDisabled ? undefined : { scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-bold transition-colors cursor-pointer",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          variantStyles[variant],
          sizeStyles[size],
          gradient &&
            variant === "primary" &&
            "bg-gradient-to-r from-primary to-primary-light hover:from-primary-dark hover:to-primary",
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
