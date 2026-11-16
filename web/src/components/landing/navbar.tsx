import Link from "next/link";
import s from "./board/home.module.css";
import { LogoMark } from "./board/logo-mark";

/**
 * The marketing top bar, shared by every marketing page (the homepage
 * included). It carries the homepage's token class (s.home) itself, so it
 * looks the same on pages that don't. Section links point at the homepage
 * (/#learn …) so they work from any page.
 */
export function Navbar() {
  return (
    <header className={`${s.home} ${s.nav} ${s.band}`}>
      <div className={s.inner}>
        <Link href="/" className={s.logo} aria-label="Veradic home">
          <LogoMark />
          Veradic
        </Link>
        <nav className={s.navLinks} aria-label="Main">
          <Link href="/#learn">How students learn</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/#rules">Responsible AI</Link>
        </nav>
        <div className={s.navRight}>
          <Link className={s.signin} href="/login">
            Sign in
          </Link>
          <Link className={`${s.btn} ${s.btnInk}`} href="/demo">
            Book a demo
          </Link>
        </div>
      </div>
    </header>
  );
}
