"use client";

import { type ReactNode, forwardRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type CardVariant = "flat" | "elevated" | "interactive";

interface CardProps {
  variant?: CardVariant;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}

// Hairline-first card system. Default `flat` is the workhorse: surface
// background with a single 1px border, no shadow. `elevated` keeps a
// softer shadow for things that genuinely float (popovers, modals).
// `interactive` strengthens the border on hover and lifts 2px — quieter
// than the prior shadow-bloom.
const variantStyles: Record<CardVariant, string> = {
  flat: "bg-surface border border-border-light",
  elevated: "bg-surface border border-border-light shadow-sm",
  interactive:
    "bg-surface border border-border-light hover:border-primary cursor-pointer transition-colors",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "flat", className, children, onClick }, ref) => {
    const classes = cn(
      "rounded-[--radius-md] p-5",
      variantStyles[variant],
      className,
    );

    if (variant === "interactive") {
      return (
        <motion.div
          ref={ref}
          whileHover={{ y: -2 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className={classes}
          onClick={onClick}
        >
          {children}
        </motion.div>
      );
    }

    return (
      <div ref={ref} className={classes} onClick={onClick}>
        {children}
      </div>
    );
  },
);
Card.displayName = "Card";
