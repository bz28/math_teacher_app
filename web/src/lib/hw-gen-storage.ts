/**
 * sessionStorage key for the bank-generation job id stashed by the
 * New Homework / New Practice wizards on submit.
 *
 * Writer: the wizards stash the kicked-off job id keyed by the new
 * assignment's id, so the HW detail page can pick it up on mount and
 * resume polling without losing the "still generating…" indicator
 * across the wizard-close → detail-route navigation.
 *
 * Reader: web/src/app/(app)/school/teacher/courses/[id]/homework/[hwId]/page.tsx
 *
 * Keeping the key construction in one place stops a future rename of
 * the prefix from silently breaking one of the four call sites.
 */
export function hwGenStorageKey(assignmentId: string): string {
  return `hw-gen-${assignmentId}`;
}
