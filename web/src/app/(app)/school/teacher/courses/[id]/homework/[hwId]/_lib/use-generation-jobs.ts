"use client";

import { useEffect, useRef, useState } from "react";
import { teacher, type BankJob } from "@/lib/api";
import { jobNotices } from "@/lib/job-notice";
import { generationJobsKey, generationProgress, withStartedJob } from "@/lib/generation-progress";
import {
  BANK_JOB_POLL_INTERVAL_MS,
  BANK_JOB_POLL_LIMIT_MS,
} from "@/lib/constants";

/**
 * The generation jobs writing problems for one homework: the ones the
 * wizard handed over in sessionStorage, plus any "Generate more" the
 * page starts (`startJob`). Polls them while they run and calls
 * `onProgress` whenever a job produced something, so the pending
 * banner shows up as the first problem lands.
 */
export function useGenerationJobs(
  courseId: string,
  assignmentId: string,
  onProgress: () => Promise<void>,
) {
  // Active bank jobs feeding this HW. Usually one (single "Generate
  // more" call or the homework wizard's single gen job), but
  // clone-as-practice fans out one job per source problem — the
  // hero's count is the sum across all jobs in the array.
  const [activeJobs, setActiveJobs] = useState<BankJob[]>([]);
  // The poll reads the latest callback without restarting on it.
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  });

  // Pick up any gen job(s) the wizard kicked off for this HW. The
  // wizard stashes a JSON array of job ids in sessionStorage on
  // "Create & generate" — usually one entry, but clone-as-practice
  // fans out one job per source problem. On landing we restore them
  // all and the polling effect drives the generating hero/strip.
  // The key survives navigation away and back; we clear it once
  // every job has reached a terminal state.
  useEffect(() => {
    const key = generationJobsKey(assignmentId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    // Validate before fetching — a malformed/legacy value would
    // either throw on parse or, worse, pass an `as string[]` cast
    // and quietly iterate characters of a bare string.
    let jobIds: string[];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        !Array.isArray(parsed) ||
        !parsed.every((x) => typeof x === "string")
      ) {
        sessionStorage.removeItem(key);
        return;
      }
      jobIds = parsed;
    } catch {
      sessionStorage.removeItem(key);
      return;
    }
    if (jobIds.length === 0) return;
    Promise.all(jobIds.map((id) => teacher.bankJob(courseId, id)))
      .then((jobs) => {
        setActiveJobs(jobs);
        if (jobs.every((j) => j.status === "done" || j.status === "failed")) {
          sessionStorage.removeItem(key);
        }
      })
      .catch(() => {
        // Stale key or deleted job(s) — drop it and fall back to the
        // manual-banner UX.
        sessionStorage.removeItem(key);
      });
  }, [assignmentId, courseId]);

  // Poll any in-flight generation jobs so the hero/strip counts climb
  // live and the pending banner pops up the moment the first item
  // lands (not just on job done). Iterates every still-running job
  // each tick — usually 1, but clone-as-practice can have many.
  // Stops polling once all reach a terminal state or the ceiling
  // trips; same pattern as the course workspace page.
  //
  // Ceiling tracking via ref because the effect re-runs every poll
  // tick (setActiveJobs always produces a new array reference, so
  // the [activeJobs] dep array re-fires). A local startedAt would
  // reset every re-run and the BANK_JOB_POLL_LIMIT_MS check would
  // never trip. The ref starts the timer on the empty→inflight
  // transition and clears on inflight→empty — partial completes
  // (some jobs done, others still running) keep the original
  // timestamp so the failsafe applies to the long-tail job.
  const pollStartRef = useRef<number | null>(null);
  useEffect(() => {
    const inflightIds = activeJobs
      .filter((j) => j.status !== "done" && j.status !== "failed")
      .map((j) => j.id);
    if (inflightIds.length === 0) {
      pollStartRef.current = null;
      return;
    }
    if (pollStartRef.current === null) {
      pollStartRef.current = Date.now();
    }
    const startedAt = pollStartRef.current;
    // Snapshot per-job produced counts at effect setup so we can
    // detect "did anything climb" without a stale closure read.
    const lastProduced = new Map(activeJobs.map((j) => [j.id, j.produced_count]));
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > BANK_JOB_POLL_LIMIT_MS) {
        setActiveJobs((prev) =>
          prev.map((j) =>
            inflightIds.includes(j.id) ? { ...j, status: "failed" as const } : j,
          ),
        );
        return;
      }
      let anyClimbed = false;
      const updates = await Promise.all(
        inflightIds.map((id) =>
          teacher
            .bankJob(courseId, id)
            .then((u) => ({ id, updated: u as BankJob | null }))
            .catch(() => ({ id, updated: null })),
        ),
      );
      for (const { id, updated } of updates) {
        if (!updated) continue;
        const prev = lastProduced.get(id) ?? 0;
        if (updated.produced_count > prev || updated.status === "done") {
          anyClimbed = true;
        }
      }
      setActiveJobs((prev) =>
        prev.map((j) => {
          const u = updates.find((x) => x.id === j.id)?.updated;
          return u ?? j;
        }),
      );
      if (anyClimbed) await onProgressRef.current();
    }, BANK_JOB_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeJobs, courseId]);

  // A job started on this page (Generate more). Its id goes where the
  // wizard's do, so the banner comes back if the teacher leaves and
  // returns while it runs, instead of an empty page inviting a second
  // (paid) generation.
  const startJob = (job: BankJob) => {
    const next = withStartedJob(activeJobs, job);
    setActiveJobs(next);
    try {
      sessionStorage.setItem(generationJobsKey(assignmentId), JSON.stringify(next.map((j) => j.id)));
    } catch {
      // Storage full or blocked: the banner just won't survive a reload.
    }
  };

  const activeGenerating = activeJobs.some(
    (j) => j.status !== "done" && j.status !== "failed",
  );
  // Counts across every job feeding this HW (hero + inline strip), or
  // just the running uploads while one is being read.
  const {
    requested: aggregateRequested,
    produced: aggregateProduced,
    reading: readingUpload,
  } = generationProgress(activeJobs);

  // Failed-generation surfacing. A job that ends `status:"failed"`
  // (backend failure OR the poll-ceiling timeout above) drops out of
  // the `activeGenerating` set, so the generating strip/hero silently
  // vanish — and a zero-produced run falls through to the empty hero
  // as if nothing ever happened. Instead, once nothing is still
  // generating but a tracked job ended failed with a shortfall, show a
  // persistent banner so the teacher knows what didn't come through
  // and can re-fire generation. Cleared automatically when they do
  // (onStarted drops terminal jobs from activeJobs).
  const failedJobs = activeJobs.filter((j) => j.status === "failed");
  const stalledShortfall = failedJobs.reduce(
    (s, j) => s + Math.max(0, j.requested_count - j.produced_count),
    0,
  );
  const generationStalled =
    !activeGenerating && failedJobs.length > 0 && stalledShortfall > 0;
  // A finished set that came back short says how many were left out (its
  // own field from the API, not an error).
  const notices = jobNotices(activeJobs, Boolean(activeGenerating));

  return {
    activeJobs,
    startJob,
    activeGenerating,
    aggregateRequested,
    aggregateProduced,
    readingUpload,
    stalledShortfall,
    generationStalled,
    notices,
  };
}
