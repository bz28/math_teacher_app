"use client";

import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  motion,
  useScroll,
  useMotionValueEvent,
  AnimatePresence,
} from "framer-motion";
import { BrowserFrame } from "./product-mockup";

/* ================================================================
   Each feature has N substeps. Scrolling advances one substep at a
   time. When a feature's substeps are exhausted, the next feature's
   text + demo swap in, and its substeps begin.
   ================================================================ */

export interface ShowcaseFeature {
  /** Title shown on the left */
  title: string;
  /** Description shown on the left */
  description: string;
  /** How many scroll ticks this feature consumes */
  substepCount: number;
  /** Render the demo for this feature given how many substeps are visible (1-based) */
  render: (visibleCount: number) => ReactNode;
  /** Optional anchor ID for deep-linking (e.g. "step-by-step") */
  anchorId?: string;
}

interface StickyShowcaseProps {
  heading: string;
  subheading: string;
  features: ShowcaseFeature[];
  /** Viewport height per substep (default 80) */
  vhPerStep?: number;
  /** Milliseconds of idle before auto-scroll starts (default 3000) */
  autoScrollDelay?: number;
  /** Pixels per frame of auto-scroll (default 1.2) */
  autoScrollSpeed?: number;
}

export function StickyShowcase({
  heading,
  subheading,
  features,
  vhPerStep = 80,
  autoScrollDelay = 3000,
  autoScrollSpeed = 1.2,
}: StickyShowcaseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const totalSubsteps = features.reduce((sum, f) => sum + f.substepCount, 0);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  const [activeFeature, setActiveFeature] = useState(0);
  const [localStep, setLocalStep] = useState(1);

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    const globalStep = Math.floor(value * totalSubsteps);
    const clamped = Math.max(0, Math.min(globalStep, totalSubsteps - 1));

    let remaining = clamped;
    let featureIdx = 0;
    for (let i = 0; i < features.length; i++) {
      if (remaining < features[i].substepCount) {
        featureIdx = i;
        break;
      }
      remaining -= features[i].substepCount;
      featureIdx = i + 1;
    }
    featureIdx = Math.min(featureIdx, features.length - 1);
    const localCount = featureIdx < features.length
      ? Math.min(remaining + 1, features[featureIdx].substepCount)
      : features[features.length - 1].substepCount;

    if (featureIdx !== activeFeature) setActiveFeature(featureIdx);
    if (localCount !== localStep) setLocalStep(localCount);
  });

  /* ── Auto-scroll when idle and in view ── */
  const isAutoScrolling = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafId = useRef<number>(0);
  const isInView = useRef(false);

  // Track whether the container is in the viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { isInView.current = entry.isIntersecting; },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const stopAutoScroll = useCallback(() => {
    isAutoScrolling.current = false;
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
  }, []);

  const startAutoScroll = useCallback(() => {
    if (isAutoScrolling.current) return;
    isAutoScrolling.current = true;

    function tick() {
      if (!isAutoScrolling.current || !isInView.current) {
        isAutoScrolling.current = false;
        return;
      }
      // Stop if we've scrolled past the container
      const progress = scrollYProgress.get();
      if (progress >= 0.99) {
        isAutoScrolling.current = false;
        return;
      }
      window.scrollBy(0, autoScrollSpeed);
      rafId.current = requestAnimationFrame(tick);
    }
    rafId.current = requestAnimationFrame(tick);
  }, [autoScrollSpeed, scrollYProgress]);

  const resetIdleTimer = useCallback(() => {
    stopAutoScroll();
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (isInView.current) {
        const progress = scrollYProgress.get();
        if (progress > 0 && progress < 0.99) {
          startAutoScroll();
        }
      }
    }, autoScrollDelay);
  }, [autoScrollDelay, startAutoScroll, stopAutoScroll, scrollYProgress]);

  // Listen for user scroll / touch / wheel to reset idle timer
  useEffect(() => {
    function onUserScroll() {
      if (isAutoScrolling.current) {
        // User took over — stop and restart idle timer
        stopAutoScroll();
      }
      resetIdleTimer();
    }
    // Use wheel and touchmove to detect intentional user scrolling
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true });
    // Also start the idle timer when component mounts
    resetIdleTimer();
    return () => {
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
      stopAutoScroll();
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [resetIdleTimer, stopAutoScroll]);

  // Calculate the scroll offset (as %) where each feature starts
  const featureOffsets: number[] = [];
  {
    let cumulative = 0;
    for (const f of features) {
      featureOffsets.push(totalSubsteps > 0 ? (cumulative / totalSubsteps) * 100 : 0);
      cumulative += f.substepCount;
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ height: `${totalSubsteps * vhPerStep}vh` }}
      className="relative"
    >
      {/* Invisible anchor divs at the scroll offset where each feature begins */}
      {features.map((f, i) =>
        f.anchorId ? (
          <div
            key={f.anchorId}
            id={f.anchorId}
            className="absolute left-0"
            style={{ top: `${featureOffsets[i]}%` }}
          />
        ) : null
      )}

      <div className="sticky top-0 flex min-h-screen items-center overflow-hidden px-6">
        <div className="mx-auto w-full max-w-5xl py-12">
          {/* Section heading */}
          <div className="mb-10 text-center md:mb-14">
            <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
              {heading}
            </h2>
            <p className="mt-3 text-lg text-text-secondary">{subheading}</p>
          </div>

          {/* Two-column layout */}
          <div className="grid items-start gap-10 md:grid-cols-2 md:gap-14">
            {/* Left: text that crossfades on feature change */}
            <div className="relative min-h-[160px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeFeature}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                >
                  <h3 className="text-2xl font-bold tracking-tight text-text-primary md:text-3xl">
                    {features[activeFeature].title}
                  </h3>
                  <p className="mt-4 leading-relaxed text-text-secondary">
                    {features[activeFeature].description}
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* Progress dots — one per feature */}
              <div className="mt-8 flex items-center gap-2">
                {features.map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      i === activeFeature
                        ? "w-6 bg-primary"
                        : i < activeFeature
                          ? "w-2 bg-primary/40"
                          : "w-2 bg-border"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Right: demo that advances substeps within a feature */}
            <div className="relative">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeFeature}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                >
                  <BrowserFrame>
                    {features[activeFeature].render(localStep)}
                  </BrowserFrame>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
