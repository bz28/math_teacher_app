import { StatusPill } from "./status-pill";

/** What a flagged count is made of, said apart and never in alarm red:
 *  an understanding check worth a look raises scrutiny (amber, like any
 *  work waiting on the teacher) and never brands the student; a photo or
 *  reading problem, or homework too long for the AI grader, is about the
 *  work's form, not the student (muted). Home's queue rows, its course
 *  rows and a course's header all say it the same way. */
export function FlagPills({
  worthALook,
  photoProblems,
  tooLong,
}: {
  worthALook: number;
  photoProblems: number;
  tooLong: number;
}) {
  return (
    <>
      {worthALook > 0 && (
        <StatusPill tone="amber" label={`Understanding check: ${worthALook} worth a look`} />
      )}
      {photoProblems > 0 && (
        <StatusPill
          tone="muted"
          label={`${photoProblems} photo or reading problem${photoProblems === 1 ? "" : "s"}`}
        />
      )}
      {tooLong > 0 && <StatusPill tone="muted" label={`${tooLong} too long to AI-grade`} />}
    </>
  );
}
