"use client";

/**
 * Banner over a variation (a bank item with a parent) in the workshop,
 * so the teacher knows they're reviewing practice, not a homework
 * problem, and which problem it's a version of. Jumping to the parent
 * is blocked while an AI proposal is pending, so unsaved chat isn't
 * lost.
 */
export function PracticeVersionBanner({
  parentTitle,
  onJumpToParent,
  isProposalPending,
  onBlocked,
}: {
  parentTitle?: string;
  onJumpToParent?: () => void;
  isProposalPending: boolean;
  onBlocked: (message: string) => void;
}) {
  return (
    <div className="mb-4 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-4 py-3 text-xs  ">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-bold text-[color:var(--color-warning-dark)] ">
          ✨ Practice problem
        </div>
        {parentTitle && onJumpToParent && (
          <button
            type="button"
            onClick={() => {
              if (isProposalPending) {
                onBlocked("Accept or discard the AI proposal first.");
                return;
              }
              onJumpToParent();
            }}
            className="text-[11px] font-semibold text-[color:var(--color-warning-dark)] underline-offset-2 hover:underline "
          >
            View parent question →
          </button>
        )}
      </div>
      {parentTitle && (
        <div className="mt-1 text-[12px] font-semibold text-[color:var(--color-warning-dark)] ">
          Practice for: <span className="font-bold">{parentTitle}</span>
        </div>
      )}
      <div className="mt-1 text-[color:var(--color-warning-dark)]/90 /80">
        Approving this makes it available as practice scaffolding —
        served via the student practice loop, not added to a homework.
      </div>
    </div>
  );
}
