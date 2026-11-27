"use client";

import { useEffect, useRef, useState } from "react";
import { teacher, type BankJob } from "@/lib/api";
import { jobNotices } from "@/lib/job-notice";
import {
  expiredJobIds,
  generationJobsKey,
  generationProgress,
  idsToRemember,
  startJobUpdate,
} from "@/lib/generation-progress";
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
  // The key survives navigation away and back; it holds only the jobs
  // still running (see the effect below the poll).
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

  // Poll any in-flight generation jobs so the banner's counts climb
  // live and the pending banner pops up the moment the first item
  // lands (not just on job done). Iterates every still-running job
  // each tick — usually 1, but clone-as-practice can have many.
  //
  // Each job gets its own BANK_JOB_POLL_LIMIT_MS ceiling, timed from
  // when it was first seen running, kept in a ref because the effect
  // re-runs every tick (setActiveJobs makes a new array). A shared
  // clock would fail a "Generate more" started late in an older job's
  // run after only a minute or two.
  const firstSeenRef = useRef(new Map<string, number>());
  useEffect(() => {
    const inflightIds = activeJobs
      .filter((j) => j.status !== "done" && j.status !== "failed")
      .map((j) => j.id);
    const firstSeen = firstSeenRef.current;
    for (const id of [...firstSeen.keys()]) {
      if (!inflightIds.includes(id)) firstSeen.delete(id);
    }
    if (inflightIds.length === 0) return;
    for (const id of inflightIds) {
      if (!firstSeen.has(id)) firstSeen.set(id, Date.now());
    }
    // Snapshot per-job produced counts at effect setup so we can
    // detect "did anything climb" without a stale closure read.
    const lastProduced = new Map(activeJobs.map((j) => [j.id, j.produced_count]));
    const interval = setInterval(async () => {
      const expired = expiredJobIds(inflightIds, firstSeen, Date.now(), BANK_JOB_POLL_LIMIT_MS);
      if (expired.length > 0) {
        setActiveJobs((prev) =>
          prev.map((j) => (expired.includes(j.id) ? { ...j, status: "failed" as const } : j)),
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

  // Remember the running jobs across leaving the page (the wizard writes
  // the same key), and forget them once none is running. Skipped while
  // nothing is tracked, so the restore above reads the key first.
  useEffect(() => {
    if (activeJobs.length === 0) return;
    const key = generationJobsKey(assignmentId);
    const ids = idsToRemember(activeJobs);
    try {
      if (ids.length > 0) sessionStorage.setItem(key, JSON.stringify(ids));
      else sessionStorage.removeItem(key);
    } catch {
      // Storage full or blocked: the banner just won't survive a reload.
    }
  }, [activeJobs, assignmentId]);

  // A job started on this page (Generate more), tracked beside any still
  // running.
  const startJob = (job: BankJob) => setActiveJobs(startJobUpdate(job));

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
