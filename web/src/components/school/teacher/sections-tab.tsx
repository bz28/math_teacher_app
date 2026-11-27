"use client";

import { useEffect, useState } from "react";
import { teacher, type TeacherSection } from "@/lib/api";
import { EmptyState } from "@/components/school/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TOUR_IDS } from "@/components/tour";
import { NewSectionModal } from "./sections/new-section-modal";
import { SectionCard } from "./sections/section-card";

export function SectionsTab({
  courseId,
  onChanged,
  showNewSection,
  onShowNewSectionChange,
  onSectionCreated,
  expandFirstRoster,
  onExpandFirstRosterConsumed,
}: {
  courseId: string;
  onChanged: () => void;
  /** Controlled "new section" modal — supplied by the onboarding tour's
   *  live handoff. Falls back to internal state when omitted. */
  showNewSection?: boolean;
  onShowNewSectionChange?: (open: boolean) => void;
  /** Fired when a section is actually created (not just the modal closing).
   *  The onboarding tour uses this to advance, the way the course step
   *  advances on course creation. */
  onSectionCreated?: () => void;
  /** Onboarding tour step two requests the first section's roster be
   *  expanded so the invite control (TOUR_IDS.teacherInvite) mounts
   *  before the spotlight measures it. One-shot: cleared via
   *  onExpandFirstRosterConsumed once consumed. */
  expandFirstRoster?: boolean;
  onExpandFirstRosterConsumed?: () => void;
}) {
  const [sections, setSections] = useState<TeacherSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewLocal, setShowNewLocal] = useState(false);
  const showNew = showNewSection ?? showNewLocal;
  const setShowNew = onShowNewSectionChange ?? setShowNewLocal;
  const [openRoster, setOpenRoster] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      setSections((await teacher.sections(courseId)).sections);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sections");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // Honour the tour's one-shot request to open the first section's
  // roster. Wait until sections have loaded (length > 0) before
  // consuming, so a first-run teacher who just created a section in
  // step one still resolves a real target. Don't override a roster the
  // teacher already has open.
  useEffect(() => {
    if (!expandFirstRoster || sections.length === 0) return;
    setOpenRoster((cur) => cur ?? sections[0].id);
    onExpandFirstRosterConsumed?.();
  }, [expandFirstRoster, sections, onExpandFirstRosterConsumed]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-text-primary">Class sections</h2>
        <button
          type="button"
          data-tour-id={TOUR_IDS.teacherNewSection}
          className="rounded-[--radius-sm] bg-primary px-4 py-2 text-sm font-semibold tracking-[0.01em] text-white transition-colors hover:bg-primary-dark"
          onClick={() => setShowNew(true)}
        >
          New section
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-[color:var(--color-error)]">{error}</p>}

      {loading ? (
        <SectionsSkeleton />
      ) : sections.length === 0 ? (
        <EmptyState
          title="No sections yet"
          description="Add a section for each class period you teach. Students join a section with its code."
          action={
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="text-sm font-semibold text-primary hover:underline"
            >
              New section →
            </button>
          }
        />
      ) : (
        <div className="mt-4 space-y-3">
          {sections.map((s) => (
            <SectionCard
              key={s.id}
              courseId={courseId}
              section={s}
              expanded={openRoster === s.id}
              onToggle={() => setOpenRoster(openRoster === s.id ? null : s.id)}
              onDeleted={() => {
                setOpenRoster(null);
                reload();
                onChanged();
              }}
              onChanged={() => {
                reload();
                onChanged();
              }}
            />
          ))}
        </div>
      )}

      {showNew && (
        <NewSectionModal
          courseId={courseId}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            // Signal a real creation BEFORE closing, so the tour advances
            // (and the close handler treats this as create, not cancel).
            onSectionCreated?.();
            setShowNew(false);
            reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/**
 * Initial-load placeholder for the sections list. Mirrors the real
 * silhouette — a stack of collapsed section cards — so the list
 * settles in place rather than flashing an empty body during load.
 */
function SectionsSkeleton() {
  return (
    <div className="mt-4 space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-3 rounded-[--radius-lg] border border-border-light bg-surface p-4"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-8 w-20 rounded-[--radius-md]" />
        </div>
      ))}
    </div>
  );
}
