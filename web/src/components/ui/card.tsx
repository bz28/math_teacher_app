"use client";

import { type ReactNode, forwardRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type CardVariant = "elevated" | "flat" | "interactive" | "gradient";

interface CardProps {
  variant?: CardVariant;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}

const variantStyles: Record<CardVariant, string> = {
  elevated: "bg-surface shadow-md border border-border-light",
  flat: "bg-card border border-border-light",
  interactive:
    "bg-surface shadow-sm border border-border-light hover:shadow-md hover:border-primary/20 cursor-pointer transition-all",
  gradient:
    "bg-gradient-to-br from-card to-primary-bg border border-border-light",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "elevated", className, children, onClick }, ref) => {
    const classes = cn(
      "rounded-[--radius-lg] p-5",
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
