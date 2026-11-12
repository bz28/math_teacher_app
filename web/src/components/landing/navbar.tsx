import Link from "next/link";
import { Logo } from "@/components/site/logo";
import { ButtonLink } from "@/components/site/button-link";

/**
 * The marketing navbar, shared by every marketing page. It carries the
 * `site` class itself so it has the new look even on pages that have not
 * moved to the notebook design yet.
 *
 * Just the logo and the two actions, at every width: the page links
 * (how it works, for districts, trust) live in the footer. Sticky, on
 * near-opaque paper so the graph grid doesn't show through as content
 * scrolls under it.
 */
export function Navbar() {
  return (
    <nav
      aria-label="Main"
      className="site sticky top-0 z-40 border-b border-hairline bg-paper/95 backdrop-blur-sm"
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 md:h-[84px] md:px-8">
        <Logo href="/" />
        <div className="ml-auto flex items-center gap-1.5 md:gap-2.5">
          <Link
            href="/login"
            className="px-2 py-2.5 text-[15px] font-bold text-ink transition-colors hover:text-veradic"
          >
            Sign in
          </Link>
          {/* Veradic is sold to schools; teachers don't self-serve, so the
              one action is booking a walkthrough. */}
          <ButtonLink href="/demo" variant="ink">
            Book a demo
          </ButtonLink>
        </div>
      </div>
    </nav>
  );
}
