"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { faqs } from "@/lib/seo";
import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <Section variant="alt" id="faq">
      <div className="mx-auto max-w-3xl">
        <div className="mb-14 text-center">
          <Eyebrow>Frequently asked</Eyebrow>
          <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
            Questions teachers and admins ask.
          </h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div key={faq.question}>
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                aria-expanded={openIndex === i}
                className="flex w-full items-center justify-between gap-4 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] px-6 py-5 text-left transition-all hover:border-[color:var(--color-primary)]"
              >
                <span className="text-base font-semibold text-[color:var(--color-text)] md:text-lg">
                  {faq.question}
                </span>
                <motion.span
                  animate={{ rotate: openIndex === i ? 45 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary-bg)] text-[color:var(--color-primary)]"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <line x1="7" y1="0" x2="7" y2="14" />
                    <line x1="0" y1="7" x2="14" y2="7" />
                  </svg>
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <p className="px-6 pb-5 pt-4 leading-relaxed text-[color:var(--color-text-secondary)]">
                      {faq.answer}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
