"use client";

import { useEffect, useCallback, useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Close on Escape key and backdrop click. Defaults to true. */
  dismissible?: boolean;
  /** Override the outer container's z-index Tailwind class. Use when
   *  this modal must paint above another modal that's already at z-50
   *  (e.g. the teacher upgrade prompt opening above a workshop dialog
   *  at z-[60]). */
  outerClassName?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  children,
  className,
  dismissible = true,
  outerClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) {
        onClose();
        return;
      }

      // Focus trapping
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;

        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose, dismissible],
  );

  // Focus management — only on open/close, not on handler changes
  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      if (panelRef.current) {
        const first = panelRef.current.querySelector(FOCUSABLE_SELECTOR) as HTMLElement;
        first?.focus();
      }
    });

    return () => {
      document.body.style.overflow = "";
      previousFocusRef.current?.focus();
    };
  }, [open]);

  // Keyboard handler — updates when dismissible changes without re-focusing
  useEffect(() => {
    if (!open) return;

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center p-4",
            outerClassName,
          )}
        >
          {/* Backdrop — warm-ink scrim using design-system overlay token
              instead of opaque black, so the page tint shows through. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 bg-[color:var(--color-overlay)] backdrop-blur-sm"
            onClick={dismissible ? onClose : undefined}
            aria-hidden
          />

          {/* Panel — hairline-bordered card on warm surface. Quieter
              entrance than the prior spring scale; the dashboard has
              no modal motion to reference, so we settle for an opacity
              fade + 4px rise. */}
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className={cn(
              "relative z-10 w-full max-w-lg rounded-[--radius-md] border border-border bg-surface p-6 shadow-md",
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
