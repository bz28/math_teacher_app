"use client";

import { useState } from "react";

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
    <div className="px-6 pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-text-muted">
          Last updated: {lastUpdated}
        </p>

        <div className="mt-10 grid gap-10 md:grid-cols-[220px_1fr] md:gap-14">
          {/* TOC — mobile toggle */}
          <div className="md:hidden">
            <button
              onClick={() => setTocOpen(!tocOpen)}
              className="flex w-full items-center justify-between rounded-[--radius-md] border border-border-light bg-surface px-4 py-3 text-sm font-semibold text-text-primary"
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
              <nav className="mt-2 rounded-[--radius-md] border border-border-light bg-surface p-4">
                <ul className="space-y-2">
                  {sections.map((s, i) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        onClick={() => setTocOpen(false)}
                        className="text-sm text-text-muted hover:text-primary transition-colors"
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
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-text-muted">
                Contents
              </p>
              <ul className="space-y-2 border-l border-border-light pl-4">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="text-sm text-text-muted hover:text-primary transition-colors"
                    >
                      {i + 1}. {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          {/* Content */}
          <div className="space-y-10">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} className="scroll-mt-28">
                <h2 className="text-xl font-bold text-text-primary">
                  {i + 1}. {s.title}
                </h2>
                {/* SAFETY: content is hardcoded in page files, never from user input or CMS */}
                <div
                  className="mt-4 space-y-4 text-text-secondary leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_strong]:text-text-primary [&_strong]:font-semibold"
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
