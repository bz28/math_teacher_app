"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { BrowserFrame } from "./product-mockup";

/* ================================================================
   TabbedShowcase — replaces the old StickyShowcase scroll trap.

   Users click tabs to switch features. Each demo auto-plays its
   substeps on a timer and loops. No scroll hijacking.
   ================================================================ */

export interface ShowcaseFeature {
  title: string;
  description: string;
  substepCount: number;
  render: (visibleCount: number) => ReactNode;
  /** Short teaser shown above the demo inside the browser frame */
  teaser?: string;
}

interface TabbedShowcaseProps {
  heading: string;
  subheading: string;
  features: ShowcaseFeature[];
  /** ID for the section element (used for anchor links) */
  id?: string;
  /** Milliseconds per substep advance (default 1800) */
  stepInterval?: number;
  /** Milliseconds to pause at the end before looping (default 2500) */
  loopPause?: number;
}

export function TabbedShowcase({
  heading,
  subheading,
  features,
  id,
  stepInterval = 1800,
  loopPause = 2500,
}: TabbedShowcaseProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [visibleCount, setVisibleCount] = useState(1);
  const [isResetting, setIsResetting] = useState(false);
  const isPaused = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { amount: 0.3 });

  const feature = features[activeTab];

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Schedule the next substep advance
  const scheduleTick = useCallback(() => {
    clearTimer();
    if (isPaused.current) return;

    const max = features[activeTab].substepCount;

    timerRef.current = setTimeout(() => {
      setVisibleCount((prev) => {
        if (prev >= max) return prev;
        return prev + 1;
      });
    }, stepInterval);
  }, [clearTimer, stepInterval, activeTab, features]);

  // When we reach the last substep, pause then loop back to 1
  useEffect(() => {
    const max = features[activeTab].substepCount;
    if (visibleCount < max || isResetting || isPaused.current || !isInView) return;

    const loopTimer = setTimeout(() => {
      setIsResetting(true);
      setTimeout(() => {
        setVisibleCount(1);
        setIsResetting(false);
      }, 350);
    }, loopPause);

    return () => clearTimeout(loopTimer);
  }, [visibleCount, activeTab, features, loopPause, isResetting, isInView]);

  // Tick while in view and not paused
  useEffect(() => {
    if (isInView && !isPaused.current) {
      scheduleTick();
    } else {
      clearTimer();
    }
    return clearTimer;
  }, [isInView, visibleCount, isResetting, scheduleTick, clearTimer]);

  const handleTabChange = useCallback(
    (index: number) => {
      if (index === activeTab) return;
      clearTimer();
      setIsResetting(false);
      setActiveTab(index);
      setVisibleCount(1);
    },
    [activeTab, clearTimer],
  );

  const handleMouseEnter = useCallback(() => {
    isPaused.current = true;
    clearTimer();
  }, [clearTimer]);

  const handleMouseLeave = useCallback(() => {
    isPaused.current = false;
    scheduleTick();
  }, [scheduleTick]);

  return (
    <section ref={sectionRef} id={id} className="px-6 py-20 md:py-28">
      <div className="mx-auto max-w-5xl">
        {/* Section heading */}
        <div className="mb-10 text-center md:mb-14">
          <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
            {heading}
          </h2>
          <p className="mt-3 text-lg text-text-secondary">{subheading}</p>
        </div>

        {/* Tab pills + progress dots */}
        <div className="mb-10 space-y-4">
          <div className="flex justify-center">
            <div className="flex gap-1.5 overflow-x-auto rounded-[--radius-pill] border border-border-light bg-card/50 p-1">
              {features.map((f, i) => (
                <button
                  key={i}
                  onClick={() => handleTabChange(i)}
                  className={`relative whitespace-nowrap rounded-[--radius-pill] px-5 py-2 text-sm font-semibold transition-colors ${
                    i === activeTab
                      ? "text-white"
                      : "text-text-secondary hover:text-primary"
                  }`}
                >
                  {i === activeTab && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 rounded-[--radius-pill] bg-primary shadow-sm"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10">{f.title}</span>
                </button>
              ))}
            </div>
          </div>
          {/* Progress dots between tabs and content */}
          <div className="flex items-center justify-center gap-2">
            {features.map((_, i) => (
              <button
                key={i}
                aria-label={`Feature ${i + 1}: ${features[i].title}`}
                onClick={() => handleTabChange(i)}
                className={`h-2 cursor-pointer rounded-full transition-all duration-300 ${
                  i === activeTab
                    ? "w-6 bg-primary"
                    : "w-2 bg-border hover:bg-primary/30"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Two-column layout */}
        <div
          className="grid items-center gap-10 md:grid-cols-2 md:gap-14"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Left: text */}
          <div>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <h3 className="text-2xl font-bold tracking-tight text-text-primary md:text-3xl">
                  {feature.title}
                </h3>
                <p className="mt-4 leading-relaxed text-text-secondary">
                  {feature.description}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Right: demo */}
          <div className="relative min-h-[460px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0 }}
                animate={{ opacity: isResetting ? 0 : 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <BrowserFrame>
                  {feature.teaser && (
                    <p className="mb-3 text-center text-[10px] font-medium text-text-muted">
                      {feature.teaser}
                    </p>
                  )}
                  {feature.render(visibleCount)}
                </BrowserFrame>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
