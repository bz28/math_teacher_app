import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border-light px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        {/* Logo + copyright */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-gradient-to-br from-primary to-primary-light">
            <span className="text-xs font-extrabold text-white">V</span>
          </div>
          <span className="text-sm text-text-muted">
            &copy; {new Date().getFullYear()} Veradic AI
          </span>
        </div>

        {/* Links */}
        <div className="flex gap-6 text-sm text-text-muted">
          <Link href="/teachers" className="hover:text-primary transition-colors">
            For Teachers
          </Link>
          <Link href="/login" className="hover:text-primary transition-colors">
            Sign In
          </Link>
          <Link href="/register" className="hover:text-primary transition-colors">
            Get Started
          </Link>
        </div>
      </div>
    </footer>
  );
}
