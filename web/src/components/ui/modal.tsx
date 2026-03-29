"use client";

import { useEffect, useCallback, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Close on Escape key and backdrop click. Defaults to true. */
  dismissible?: boolean;
}

export function Modal({
  open,
  onClose,
  children,
  className,
  dismissible = true,
}: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
    },
    [onClose, dismissible],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={dismissible ? onClose : undefined}
            aria-hidden
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className={cn(
              "relative z-10 w-full max-w-lg rounded-[--radius-xl] bg-white p-6 shadow-lg",
              className,
            )}
            role="dialog"
            aria-modal="true"
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
