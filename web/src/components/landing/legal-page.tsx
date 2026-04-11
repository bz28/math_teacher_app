"use client";

import { useState } from "react";
import { Eyebrow } from "./eyebrow";

interface Section {
  id: string;
  title: string;
  content: string;
}

interface LegalPageProps {
  title: string;
  lastUpdated: string;
  sections: Section[];
}

export function LegalPage({ title, lastUpdated, sections }: LegalPageProps) {
  const [tocOpen, setTocOpen] = useState(false);

  return (
    <div className="bg-[color:var(--color-surface)] px-6 pt-24 pb-24 md:pt-32 md:pb-32">
      <div className="mx-auto max-w-5xl">
        <Eyebrow>Legal</Eyebrow>
        <h1 className="mt-6 text-display-lg text-[color:var(--color-text)]">
          {title}
        </h1>
        <p className="mt-4 text-sm text-[color:var(--color-text-muted)]">
          Last updated: {lastUpdated}
        </p>

        <div className="mt-14 grid gap-10 md:grid-cols-[220px_1fr] md:gap-16">
          {/* TOC — mobile toggle */}
          <div className="md:hidden">
            <button
              onClick={() => setTocOpen(!tocOpen)}
              className="flex w-full items-center justify-between rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] px-5 py-4 text-sm font-semibold text-[color:var(--color-text)]"
            >
              Table of Contents
              <svg
                className={`h-4 w-4 transition-transform ${tocOpen ? "rotate-180" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {tocOpen && (
              <nav className="mt-2 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] p-5">
                <ul className="space-y-3">
                  {sections.map((s, i) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        onClick={() => setTocOpen(false)}
                        className="text-sm text-[color:var(--color-text-secondary)] transition-colors hover:text-[color:var(--color-primary)]"
                      >
                        {i + 1}. {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>

          {/* TOC — desktop sticky sidebar */}
          <nav className="hidden md:block">
            <div className="sticky top-28">
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-[color:var(--color-text-muted)]">
                Contents
              </p>
              <ul className="space-y-3 border-l border-[color:var(--color-border-light)] pl-5">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="text-sm text-[color:var(--color-text-secondary)] transition-colors hover:text-[color:var(--color-primary)]"
                    >
                      {i + 1}. {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          {/* Content */}
          <div className="space-y-12">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} className="scroll-mt-28">
                <h2 className="text-2xl font-bold text-[color:var(--color-text)] md:text-3xl">
                  {i + 1}. {s.title}
                </h2>
                {/* SAFETY: content is hardcoded in page files, never from user input or CMS */}
                <div
                  className="mt-5 space-y-4 leading-relaxed text-[color:var(--color-text-secondary)] [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_strong]:text-[color:var(--color-text)] [&_strong]:font-semibold"
                  dangerouslySetInnerHTML={{ __html: s.content }}
                />
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
