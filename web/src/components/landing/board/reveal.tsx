"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Plays a section's chalk write-in once, when it scrolls into view.
 *
 * The server renders the content fully visible (data-state="rest"). On
 * mount, if the block is still below the fold it is "armed" (hidden by
 * CSS), then set to "play" when it enters the viewport. A block already on
 * screen, or a visitor who prefers reduced motion (handled in CSS), never
 * hides. The attribute is written straight to the element: it only drives
 * CSS, so there is nothing for React to re-render.
 */
export function Reveal({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.dataset.state = "armed";
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.state = "play";
          io.disconnect();
        }
      },
      // Any visible part plays it: a block taller than the viewport could
      // otherwise never reach a ratio threshold.
      { rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} data-state="rest">
      {children}
    </div>
  );
}
