import { LockIcon } from "@/components/ui/icons";

/** "Tue, Nov 10, 11:59 PM" in the student's own time zone. */
function closedAt(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Stands where the upload panel would be once a homework set to "Closed
 * after due date" has passed its due date without a turn-in. Same shell
 * as the upload panel so the page keeps its shape, but neutral rather
 * than red: it's the homework's state, not something the student did
 * wrong just now, and the one thing to do about it is ask the teacher.
 */
export function HomeworkClosedPanel({ dueAt }: { dueAt: string }) {
  return (
    <div
      role="status"
      className="mt-8 overflow-hidden rounded-[--radius-lg] border border-border bg-surface shadow-[0_1px_2px_rgba(20,19,15,0.04)]"
    >
      <div className="flex items-start gap-4 px-6 py-6">
        <span
          aria-hidden
          className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-text-secondary"
        >
          <LockIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="font-serif text-[1.5rem] leading-tight text-text-primary">
            This homework is closed
          </h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
            It closed on{" "}
            <span className="font-semibold text-text-primary">{closedAt(dueAt)}</span>,
            so it can&rsquo;t be turned in anymore. If you still need to turn it
            in, ask your teacher to reopen it for you.
          </p>
        </div>
      </div>
    </div>
  );
}
