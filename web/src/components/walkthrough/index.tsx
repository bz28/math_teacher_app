"use client";

/**
 * Teacher video walkthrough — one chaptered video of the whole job,
 * setup to published grades. Replaces the old spotlight tour.
 *
 * The video, captions and poster are produced by the scripted recorder
 * (`scripts/walkthrough/`), which also writes `walkthrough.json` (chapter
 * ids, titles, start times). Re-run it after a UI change and commit the
 * outputs; nothing here hard-codes a timestamp.
 *
 * Open it from anywhere with `useWalkthrough().open(chapterId)`, or drop
 * a `<WatchHow chapter="homework" />` link beside the thing it explains.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import data from "./walkthrough.json";

export const WALKTHROUGH_SRC = "/walkthrough/walkthrough.mp4";
const CAPTIONS_SRC = "/walkthrough/walkthrough.vtt";
const POSTER_SRC = "/walkthrough/poster.jpg";

export type ChapterId =
  | "welcome"
  | "courses"
  | "students"
  | "materials"
  | "homework"
  | "grading"
  | "understanding-check"
  | "grades"
  | "practice-insights";

interface Chapter {
  id: ChapterId;
  title: string;
  start: number;
  /** Seconds, derived from the next chapter's start (or the video end). */
  length: number;
}

const CHAPTERS: Chapter[] = data.chapters.map((c, i, all) => ({
  id: c.id as ChapterId,
  title: c.title,
  start: c.start,
  length: (all[i + 1]?.start ?? data.duration) - c.start,
}));

export function formatLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function chapterLength(id: ChapterId): number {
  return CHAPTERS.find((c) => c.id === id)?.length ?? 0;
}

interface WalkthroughContextValue {
  open: (chapter?: ChapterId) => void;
}

const WalkthroughContext = createContext<WalkthroughContextValue | null>(null);

export function useWalkthrough(): WalkthroughContextValue {
  const ctx = useContext(WalkthroughContext);
  if (!ctx) throw new Error("useWalkthrough must be used within <WalkthroughProvider>");
  return ctx;
}

export function WalkthroughProvider({ children }: { children: ReactNode }) {
  // null = closed; otherwise the chapter to start at.
  const [startAt, setStartAt] = useState<ChapterId | null>(null);
  const open = useCallback((chapter: ChapterId = "welcome") => setStartAt(chapter), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <WalkthroughContext.Provider value={value}>
      {children}
      <WalkthroughDialog startAt={startAt} onClose={() => setStartAt(null)} />
    </WalkthroughContext.Provider>
  );
}

function WalkthroughDialog({
  startAt,
  onClose,
}: {
  startAt: ChapterId | null;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [current, setCurrent] = useState<ChapterId>("welcome");

  const seek = useCallback((id: ChapterId, play: boolean) => {
    const v = videoRef.current;
    const ch = CHAPTERS.find((c) => c.id === id);
    if (!v || !ch) return;
    v.currentTime = ch.start;
    setCurrent(id);
    if (play) void v.play().catch(() => {});
  }, []);

  // Each open lands on the requested chapter. The video element mounts
  // with the modal, so wait for its metadata before seeking.
  useEffect(() => {
    if (startAt === null) return;
    const v = videoRef.current;
    if (!v) return;
    const go = () => seek(startAt, false);
    if (v.readyState >= 1) go();
    else v.addEventListener("loadedmetadata", go, { once: true });
    return () => v.removeEventListener("loadedmetadata", go);
  }, [startAt, seek]);

  const onTimeUpdate = () => {
    const t = videoRef.current?.currentTime ?? 0;
    // Last chapter whose start we've passed.
    let at: ChapterId = CHAPTERS[0].id;
    for (const c of CHAPTERS) if (t >= c.start - 0.25) at = c.id;
    if (at !== current) setCurrent(at);
  };

  return (
    <Modal
      open={startAt !== null}
      onClose={onClose}
      portal
      labelledById="walkthrough-title"
      outerClassName="z-[70]"
      className="max-w-5xl p-0"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border-light px-6 py-4">
        <div className="min-w-0">
          <h2
            id="walkthrough-title"
            className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-text-primary"
          >
            How Veradic works
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Nine short chapters, from setting up a class to publishing grades. Jump to any one.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close walkthrough"
          className="shrink-0 rounded-[--radius-sm] p-2 text-text-muted transition-colors hover:bg-[color:var(--color-surface-alt)] hover:text-text-primary"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="grid max-h-[calc(100vh-10rem)] gap-0 overflow-y-auto md:grid-cols-[1fr_280px] md:overflow-visible">
        <div className="bg-black md:rounded-bl-[--radius-md]">
          <video
            ref={videoRef}
            src={WALKTHROUGH_SRC}
            poster={POSTER_SRC}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
            className="aspect-video w-full"
          >
            <track kind="captions" src={CAPTIONS_SRC} srcLang="en" label="English" default />
          </video>
        </div>

        <nav aria-label="Chapters" className="border-t border-border-light md:max-h-[min(70vh,560px)] md:overflow-y-auto md:border-l md:border-t-0">
          <ol className="py-2">
            {CHAPTERS.map((c, i) => {
              const active = c.id === current;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => seek(c.id, true)}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "relative flex w-full items-baseline gap-3 px-5 py-2.5 text-left transition-colors",
                      active
                        ? "bg-[color:var(--color-primary-bg)]"
                        : "hover:bg-[color:var(--color-surface-alt)]",
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute inset-y-1.5 left-0 w-[2px] bg-[color:var(--color-primary)]"
                      />
                    )}
                    <span className="w-4 shrink-0 text-right text-xs tabular-nums text-text-muted">{i + 1}</span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 text-sm",
                        active ? "font-semibold text-text-primary" : "text-text-secondary",
                      )}
                    >
                      {c.title}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">{formatLength(c.length)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </Modal>
  );
}

/**
 * Inline "Watch how" link that opens the walkthrough at one chapter.
 * Sits beside the control or empty state it explains.
 */
export function WatchHow({ chapter, className }: { chapter: ChapterId; className?: string }) {
  const { open } = useWalkthrough();
  return (
    <button
      type="button"
      onClick={() => open(chapter)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[--radius-sm] px-1.5 py-1 text-sm font-medium text-text-secondary transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
      </svg>
      {/* From the start, the link means the whole video, not chapter one. */}
      {chapter === "welcome" ? "Watch the walkthrough" : "Watch how"}
      <span className="tabular-nums text-text-muted">
        {formatLength(chapter === "welcome" ? data.duration : chapterLength(chapter))}
      </span>
    </button>
  );
}
