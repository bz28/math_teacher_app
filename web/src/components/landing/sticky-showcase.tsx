"use client";

import { useRef, useState, type ReactNode } from "react";
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
}

interface StickyShowcaseProps {
  heading: string;
  subheading: string;
  features: ShowcaseFeature[];
  /** Viewport height per substep (default 80) */
  vhPerStep?: number;
}

export function StickyShowcase({
  heading,
  subheading,
  features,
  vhPerStep = 80,
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
    // Map 0-1 scroll progress to a global substep index (0-based)
    const globalStep = Math.floor(value * totalSubsteps);
    const clamped = Math.max(0, Math.min(globalStep, totalSubsteps - 1));

    // Walk through features to find which one this global step falls into
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
    // Clamp to last feature if we've scrolled past
    featureIdx = Math.min(featureIdx, features.length - 1);
    const localCount = featureIdx < features.length
      ? Math.min(remaining + 1, features[featureIdx].substepCount)
      : features[features.length - 1].substepCount;

    if (featureIdx !== activeFeature) setActiveFeature(featureIdx);
    if (localCount !== localStep) setLocalStep(localCount);
  });

  return (
    <div
      ref={containerRef}
      style={{ height: `${totalSubsteps * vhPerStep}vh` }}
      className="relative"
    >
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
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.3 }}
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
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
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
