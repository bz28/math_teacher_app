// What the homework page says while generation jobs run, and the order the
// review queue walks pending problems in.

export interface ProgressJob {
  status: string;
  mode?: string | null;
  requested_count: number;
  produced_count: number;
}

const running = (j: ProgressJob) => j.status !== "done" && j.status !== "failed";

/** Counts across every job feeding the homework (clone-as-practice can run
 *  several), and whether what's left is an upload being read. An upload
 *  copies problems off the teacher's pages and doesn't know how many until
 *  it has read them (requested_count stays 0 until then). While reading,
 *  only the running uploads count: a finished generate job's "5 of 5"
 *  would otherwise be shown as problems read from the pages. */
export function generationProgress(jobs: ProgressJob[]): {
  requested: number;
  produced: number;
  reading: boolean;
} {
  const live = jobs.filter(running);
  const reading = live.length > 0 && live.every((j) => j.mode === "upload");
  const counted = reading ? live : jobs;
  return {
    requested: counted.reduce((s, j) => s + j.requested_count, 0),
    produced: counted.reduce((s, j) => s + j.produced_count, 0),
    reading,
  };
}

/** "Generating 6 problems…", or for an upload "Reading 6 problems from your
 *  pages…" — and before the upload has been read, no count at all (it is 0
 *  until then, which read as "Generating 0 problems…"). */
export function generatingLabel(count: number, reading: boolean, more?: "more"): string {
  const noun = count === 1 ? "problem" : "problems";
  if (reading) {
    if (count === 0) {
      return more ? "Reading more problems from your pages…" : "Reading your pages…";
    }
    return more
      ? `Reading ${count} more ${noun} from your pages…`
      : `Reading ${count} ${noun} from your pages…`;
  }
  return more ? `Generating ${count} more…` : `Generating ${count} ${noun}…`;
}

/** Pending problems oldest first, so a set is approved in the order it was
 *  read or written (problem 1 first) and items that land mid-review join at
 *  the end. The bank lists newest first. Returns a new array. */
export function oldestFirst<T extends { created_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** The jobs to track after one more starts: the new job plus those still
 *  running (a finished one would keep inflating the counts, and an old
 *  failure would come back as a stalled banner). */
export function withStartedJob<T extends ProgressJob & { id: string }>(jobs: T[], job: T): T[] {
  return [...jobs.filter((j) => running(j) && j.id !== job.id), job];
}

/** The state update for starting `job`: applied to the latest jobs (a poll
 *  tick may have moved them since the start was clicked), handing the ids
 *  now tracked to `remember` so they survive leaving the page. */
export function startJobUpdate<T extends ProgressJob & { id: string }>(
  job: T,
  remember: (ids: string[]) => void,
): (prev: T[]) => T[] {
  return (prev) => {
    const next = withStartedJob(prev, job);
    remember(next.map((j) => j.id));
    return next;
  };
}

/** Where the homework page keeps the ids of the jobs feeding it, so they
 *  are picked up again after the teacher leaves and comes back (the
 *  wizard writes the same key). */
export function generationJobsKey(assignmentId: string): string {
  return `hw-gen-${assignmentId}`;
}
