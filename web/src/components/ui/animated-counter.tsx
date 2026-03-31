"use client";

import { useEffect, useRef } from "react";
import { useMotionValue, useTransform, animate, motion } from "framer-motion";

interface AnimatedCounterProps {
  from?: number;
  to: number;
  duration?: number;
  decimals?: number;
  className?: string;
}

export function AnimatedCounter({
  from = 0,
  to,
  duration = 1,
  decimals = 0,
  className,
}: AnimatedCounterProps) {
  const count = useMotionValue(from);
  const display = useTransform(count, (v) => v.toFixed(decimals));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(count, to, {
      duration,
      ease: "easeOut",
    });
    return controls.stop;
  }, [count, to, duration]);

  // Subscribe to display changes and update the DOM directly
  useEffect(() => {
    const unsubscribe = display.on("change", (v) => {
      if (ref.current) ref.current.textContent = v;
    });
    return unsubscribe;
  }, [display]);

  return (
    <motion.span ref={ref} className={className}>
      {from.toFixed(decimals)}
    </motion.span>
  );
}
