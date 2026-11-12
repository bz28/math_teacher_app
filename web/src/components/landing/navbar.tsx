import Link from "next/link";
import { Logo } from "@/components/site/logo";
import { NavLinks } from "@/components/site/nav-links";
import { ButtonLink } from "@/components/site/button-link";

/**
 * The marketing navbar, shared by every marketing page. It carries the
 * `site` class itself so it has the new look even on pages that have not
 * moved to the notebook design yet.
 *
 * Sticky, on near-opaque paper so the graph grid doesn't fight the links
 * as content scrolls under it. On phones only the logo and the two actions
 * fit, so the page links hide below md.
 */
export function Navbar() {
  return (
    <nav
      aria-label="Main"
      className="site sticky top-0 z-40 border-b border-hairline bg-paper/95 backdrop-blur-sm"
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 md:gap-7 md:h-[84px] md:px-8">
        <Logo href="/" />
        <div className="hidden md:ml-5 md:block">
          <NavLinks />
        </div>
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
