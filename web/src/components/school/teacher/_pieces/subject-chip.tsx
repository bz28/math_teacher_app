import { cn } from "@/lib/utils";

/** Subject label + tint, in one place. Previously the dashboard rendered
 *  a subject two ways — a tinted chip with hardcoded physics/chemistry
 *  hex on the courses list (CourseRow) vs. a flat gray chip on the
 *  "Needs you today" queue (QueueRow). This unifies both onto the
 *  [data-subject] design tokens from globals.css: setting `data-subject`
 *  on the chip makes `--color-primary-bg` / `--color-primary-dark`
 *  resolve to that subject's palette, so a palette tweak lands once. */
const SUBJECT_LABEL: Record<string, string> = {
  math: "Math",
  physics: "Physics",
  chemistry: "Chemistry",
};

export function SubjectChip({
  subject,
  className,
}: {
  subject: string;
  className?: string;
}) {
  const label = SUBJECT_LABEL[subject] ?? subject;
  return (
    <span
      data-subject={subject}
      className={cn(
        "rounded-[2px] bg-[color:var(--color-primary-bg)] px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-primary-dark)]",
        className,
      )}
    >
      {label}
    </span>
  );
}
