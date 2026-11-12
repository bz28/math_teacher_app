"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// "How it works" goes to the homepage's first demo, from any page.
const LINKS = [
  { label: "How it works", href: "/#integrity" },
  { label: "For districts", href: "/for-districts" },
  { label: "Trust", href: "/trust" },
];

/** The navbar's page links, with the current page underlined in green. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex items-center gap-[26px]">
      {LINKS.map((l) => {
        const current = l.href === pathname;
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={current ? "page" : undefined}
              className={
                current
                  ? "border-b-2 border-veradic pb-0.5 text-[15px] font-bold text-ink"
                  : "text-[15px] font-semibold text-ink-soft transition-colors hover:text-ink"
              }
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
