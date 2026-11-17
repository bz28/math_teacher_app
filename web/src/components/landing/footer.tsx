import Link from "next/link";
import s from "./board/home.module.css";
import { LogoMark } from "./board/logo-mark";

/**
 * The marketing footer, shared by every marketing page. Carries s.home for
 * the same reason as the Navbar.
 */
export function Footer() {
  return (
    <footer className={`${s.home} ${s.foot} ${s.band}`}>
      <div className={s.inner}>
        <div className={s.footBrand}>
          <Link href="/" className={s.logo} style={{ color: "var(--chalk)" }}>
            <LogoMark accent="var(--chalk-yellow)" />
            Veradic
          </Link>
          <p>Classroom AI that helps students understand their math homework, and shows teachers who does.</p>
        </div>
        <nav aria-labelledby="f-product">
          <h2 id="f-product">Product</h2>
          <Link href="/#learn">How students learn</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/#rules">Responsible AI</Link>
          <Link href="/for-districts">For districts</Link>
          <Link href="/demo">Book a demo</Link>
        </nav>
        <nav aria-labelledby="f-subjects">
          <h2 id="f-subjects">Subjects</h2>
          <Link href="/subjects/math">Math</Link>
          <Link href="/subjects/physics">Physics</Link>
          <Link href="/subjects/chemistry">Chemistry</Link>
        </nav>
        <nav aria-labelledby="f-company">
          <h2 id="f-company">Company</h2>
          <Link href="/trust">Trust &amp; security</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/support">Support</Link>
          <Link href="/login">Sign in</Link>
        </nav>
        <div className={s.footSmall}>
          <span>&copy; {new Date().getFullYear()} Veradic LLC. All rights reserved.</span>
          <span>Students and classes shown are examples.</span>
        </div>
      </div>
    </footer>
  );
}
