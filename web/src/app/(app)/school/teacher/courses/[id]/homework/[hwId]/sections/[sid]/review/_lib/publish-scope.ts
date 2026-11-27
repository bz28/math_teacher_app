/** Where a Publish reaches. Every scope releases approved grades only. */
export type PublishScope =
  | { kind: "section" }
  | { kind: "all" }
  | { kind: "student"; submissionId: string };

/** The grade a publish in `scope` releases: graded, approved, and new
 *  or edited since it was last published. */
export function releases(
  g: {
    final_score: number | null;
    reviewed_at: string | null;
    grade_published_at: string | null;
    grade_dirty: boolean;
  },
  submissionId: string,
  scope: PublishScope,
): boolean {
  if (scope.kind === "student" && submissionId !== scope.submissionId) return false;
  return (
    g.final_score !== null &&
    !!g.reviewed_at &&
    (g.grade_published_at === null || g.grade_dirty)
  );
}
