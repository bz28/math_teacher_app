import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-extrabold tracking-tight text-text-primary">
        Veradic AI
      </h1>
      <p className="text-lg text-text-secondary">Snap. Learn. Master.</p>
      <Link
        href="/login"
        className="rounded-[--radius-pill] bg-primary px-8 py-3 font-bold text-text-on-primary transition-colors hover:bg-primary-dark"
      >
        Get Started
      </Link>
    </div>
  );
}
