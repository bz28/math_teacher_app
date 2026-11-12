"use client";

import { useEffect, useState } from "react";

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

/**
 * The text pages (Trust, Privacy, Terms) in the notebook design: a header
 * on the graph paper, an "On this page" list on the left, and the text on
 * a white sheet. Below lg the list folds into a button, so a phone reader
 * gets to the text first.
 *
 * Layout only: the wording lives in each page file and is passed through
 * untouched, section numbers included (people cite "section 7").
 */
export function LegalPage({ title, lastUpdated, sections }: LegalPageProps) {
  const [tocOpen, setTocOpen] = useState(false);
  const active = useActiveSection(sections.map((s) => s.id));

  return (
    <div className="mx-auto max-w-[1200px] px-4 md:px-8">
      <header className="pb-10 pt-12 md:pb-14 md:pt-16">
        <h1 className="site-h1 max-w-[820px]">{title}</h1>
        <p className="m-0 mt-4 text-[15px] text-ink-soft">Last updated: {lastUpdated}</p>
      </header>

      <div className="flex flex-col gap-6 pb-24 md:pb-28 lg:flex-row lg:items-start lg:gap-14">
        <nav
          aria-label="On this page"
          className="lg:sticky lg:top-[108px] lg:max-h-[calc(100vh-132px)] lg:w-[240px] lg:shrink-0 lg:overflow-y-auto"
        >
          {/* Phones and tablets: a button that opens the list. */}
          <button
            type="button"
            onClick={() => setTocOpen((o) => !o)}
            aria-expanded={tocOpen}
            aria-controls="legal-toc"
            className="flex w-full items-center justify-between rounded-[6px] border border-hairline bg-white px-4 py-3.5 text-[15px] font-extrabold text-ink lg:hidden"
          >
            On this page
            <svg
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${tocOpen ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {/* Desktop: a plain label above an always-open list. */}
          <p className="m-0 mb-3 hidden text-sm font-extrabold text-ink lg:block">On this page</p>
          <ol
            id="legal-toc"
            className={`m-0 list-none flex-col gap-1 p-0 text-[15px] max-lg:mt-2 max-lg:rounded-[6px] max-lg:border max-lg:border-hairline max-lg:bg-white max-lg:p-3 lg:flex ${tocOpen ? "flex" : "hidden"}`}
          >
            {sections.map((s, i) => {
              const current = s.id === active;
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={() => setTocOpen(false)}
                    aria-current={current ? "location" : undefined}
                    className={`block border-l-[3px] py-1 pl-2.5 leading-snug transition-colors ${
                      current
                        ? "border-veradic font-bold text-ink"
                        : "border-transparent text-ink-soft hover:text-ink"
                    }`}
                  >
                    {i + 1}. {s.title}
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>

        <article className="min-w-0 max-w-[760px] flex-1 rounded-[4px] border border-hairline bg-white px-5 py-8 sm:px-10 sm:py-10 md:px-14 md:py-12">
          {sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              className="mt-11 scroll-mt-[88px] border-t border-rule pt-9 first:mt-0 first:border-t-0 first:pt-0 md:scroll-mt-[108px]"
            >
              <h2 className="m-0 text-[26px] font-black leading-[1.1] tracking-[-0.03em] text-ink md:text-[30px]">
                {i + 1}. {s.title}
              </h2>
              {/* SAFETY: content is hardcoded in page files, never from user input or CMS */}
              <div
                className="mt-4 space-y-4 text-[17px] leading-[1.7] text-[#2F3947] [&_a]:font-semibold [&_a]:text-veradic [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-veradic-dark [&_li]:mt-2 [&_strong]:font-bold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-[22px]"
                dangerouslySetInnerHTML={{ __html: s.content }}
              />
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}

/**
 * The section being read: the last one whose heading has passed the top
 * of the reading area (just under the sticky navbar). Before the first
 * heading gets there, the first section counts as current.
 */
function useActiveSection(ids: string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join(",");

  useEffect(() => {
    const list = key.split(",");
    function update() {
      // 140px: below the 84px navbar, with a little reading margin.
      let current = list[0];
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 140) current = id;
      }
      // At the very bottom the last sections can't scroll up to the line;
      // the reader is at the end, so the last one is current.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = list[list.length - 1];
      }
      setActive(current);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [key]);

  return active;
}
