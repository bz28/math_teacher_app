import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./logo";

/**
 * The frame for the signed-out account pages (sign in, register): graph
 * paper, a quiet top bar with the logo and one cross-link, and the page's
 * white card centred below. No full navbar: someone signing in has one
 * job here.
 */
export function AuthShell({
  children,
  switchPrompt,
  switchLabel,
  switchHref,
}: {
  children: ReactNode;
  /** The question before the cross-link, hidden on phones to save room. */
  switchPrompt?: string;
  switchLabel?: string;
  switchHref?: string;
}) {
  return (
    <div className="site graph-paper flex min-h-full flex-1 flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-3 px-4 md:h-[84px] md:px-8">
        <Logo href="/" />
        {switchLabel && switchHref && (
          <p className="m-0 ml-auto text-[15px] font-semibold text-ink-soft">
            {switchPrompt && <span className="hidden sm:inline">{switchPrompt} </span>}
            <Link href={switchHref} className="font-bold text-ink underline underline-offset-4 transition-colors hover:text-veradic">
              {switchLabel}
            </Link>
          </p>
        )}
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-20 pt-4 sm:pt-10 md:items-center md:pb-24">
        {children}
      </main>
    </div>
  );
}

/** The white paper card the form sits on. */
export const AUTH_CARD =
  "w-full max-w-[460px] rounded-[4px] border border-hairline bg-white px-5 py-7 shadow-[0_30px_60px_-30px_rgba(29,38,51,0.45)] sm:px-9 sm:py-9";

/** The card's heading. */
export const AUTH_H1 = "m-0 text-[28px] font-black leading-[1.05] tracking-[-0.03em] text-ink sm:text-[32px]";
