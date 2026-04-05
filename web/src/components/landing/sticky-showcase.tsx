"use client";

import { useRef, useState, type ReactNode } from "react";
import { motion, useScroll, useMotionValueEvent, AnimatePresence } from "framer-motion";
import { BrowserFrame } from "./product-mockup";

export interface ShowcaseItem {
  title: string;
  description: string;
  demo: ReactNode;
}

interface StickyShowcaseProps {
  heading: string;
  subheading: string;
  items: ShowcaseItem[];
}

export function StickyShowcase({ heading, subheading, items }: StickyShowcaseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });
  const [activeIndex, setActiveIndex] = useState(0);

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    // Map scroll progress to item index
    // Use a slightly earlier threshold so the last item has room to display
    const raw = value * items.length;
    const index = Math.min(Math.floor(raw), items.length - 1);
    if (index !== activeIndex) {
      setActiveIndex(index);
    }
  });

  return (
    <div
      ref={containerRef}
      // Each item gets ~100vh of scroll distance
      style={{ height: `${items.length * 100}vh` }}
      className="relative"
    >
      <div className="sticky top-0 flex min-h-screen items-center overflow-hidden px-6">
        <div className="mx-auto w-full max-w-5xl py-16">
          {/* Section heading — visible at top */}
          <div className="mb-10 text-center md:mb-14">
            <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
              {heading}
            </h2>
            <p className="mt-3 text-lg text-text-secondary">
              {subheading}
            </p>
          </div>

          {/* Two-column: text + demo */}
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-14">
            {/* Left: text content that swaps */}
            <div className="relative min-h-[140px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeIndex}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.35 }}
                >
                  <h3 className="text-2xl font-bold tracking-tight text-text-primary md:text-3xl">
                    {items[activeIndex].title}
                  </h3>
                  <p className="mt-4 leading-relaxed text-text-secondary">
                    {items[activeIndex].description}
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* Progress dots */}
              <div className="mt-8 flex items-center gap-2">
                {items.map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      i === activeIndex
                        ? "w-6 bg-primary"
                        : "w-2 bg-border"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Right: demo that swaps */}
            <div className="relative">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeIndex}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.35 }}
                >
                  <BrowserFrame>
                    {items[activeIndex].demo}
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
