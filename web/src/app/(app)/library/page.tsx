"use client";

import { Card } from "@/components/ui";

export default function LibraryPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-text-primary">Library</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Your saved problems and practice sets
        </p>
      </header>

      <Card className="flex flex-col items-center gap-4 p-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-bg">
          <svg
            className="h-8 w-8 text-primary"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-text-primary">Nothing saved yet</h2>
        <p className="max-w-md text-sm text-text-secondary">
          Save problems from a session to revisit them later, or build practice sets
          from past work.
        </p>
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-3 py-1 text-xs font-semibold text-warning-dark">
          ✨ Coming soon
        </span>
      </Card>
    </div>
  );
}
