"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Button } from "./button";

interface PageErrorStateProps {
  /** A friendly, user-safe message. Never pass raw exception/API text —
   *  this surface is read by students. */
  message: string;
  onRetry: () => void;
  /** Headline above the message. Defaults to a calm, reassuring line. */
  title?: string;
  /** Action-button label. Defaults to "Try again" — override when the
   *  recovery action isn't literally a retry (e.g. "Back to Learn" on a
   *  generation surface that sends the student back to start over), so
   *  the button never promises something it doesn't do. */
  retryLabel?: string;
}

function AlertIcon() {
  return (
    <svg
      className="h-10 w-10 text-error"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/**
 * Crafted full-page error surface. Same editorial grammar as
 * `EmptyState` (icon → serif title → friendly copy → action), tuned for
 * load failures: a warm-ink error icon and a Retry. Use this instead of
 * dumping a raw `{error}` string — keep technical exception text away
 * from students.
 */
export function PageErrorState({
  message,
  onRetry,
  title = "We hit a snag",
  retryLabel = "Try again",
}: PageErrorStateProps) {
  const reduce = useReducedMotion();
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center py-16 text-center">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-error-light"
      >
        <AlertIcon />
      </motion.div>
      <h2 className="font-serif text-[26px] leading-tight text-text-primary">
        {title}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
        {message}
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry} className="mt-6">
        {retryLabel}
      </Button>
    </div>
  );
}
