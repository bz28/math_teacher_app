import {
  createPracticeBatchSession,
  createSession,
  generatePracticeProblems,
  getSession,
  respondToStep,
} from "../services/api";
import { initialState, type SessionPhase, type StoreGet, type StoreSet } from "./types";

export function createLearnActions(set: StoreSet, get: StoreGet) {
  return {
    startSession: async (problem: string, mode = "learn") => {
      const { subject } = get();
      set({ phase: "loading", error: null });
      try {
        const session = await createSession(problem, mode, subject);
        set({ session, phase: "awaiting_input", lastResponse: null });
      } catch (e) {
        set({ phase: "error", error: (e as Error).message });
      }
    },

    resumeSession: async (sessionId: string) => {
      set({ phase: "loading", error: null });
      try {
        const session = await getSession(sessionId);
        set({ session, phase: "awaiting_input", lastResponse: null, subject: session.subject });
      } catch (e) {
        set({ phase: "error", error: (e as Error).message });
      }
    },

    startLearnQueue: async (problems: string[]) => {
      if (problems.length === 0) return;
      const { subject } = get();
      set({ ...initialState, subject, phase: "loading" });
      try {
        const session = await createSession(problems[0], "learn", subject);
        set({
          session,
          phase: "awaiting_input",
          lastResponse: null,
          learnQueue: {
            problems,
            currentIndex: 0,
            flags: new Array(problems.length).fill(false),
            preloadedSessions: {},
          },
        });

        // Pre-generate sessions for remaining problems in background
        if (problems.length > 1) {
          problems.slice(1).forEach((p, i) => {
            const queueIndex = i + 1;
            createSession(p, "learn", subject)
              .then((s) => {
                const { learnQueue: lq } = get();
                if (!lq) return;
                set({
                  learnQueue: {
                    ...lq,
                    preloadedSessions: { ...lq.preloadedSessions, [queueIndex]: s },
                  },
                });
              })
              .catch(() => {});
          });
        }
      } catch (e) {
        set({ phase: "error", error: (e as Error).message });
      }
    },

    advanceLearnQueue: async () => {
      const { learnQueue } = get();
      if (!learnQueue) return;

      const nextIndex = learnQueue.currentIndex + 1;
      if (nextIndex >= learnQueue.problems.length) {
        set({ phase: "learn_summary", session: null, lastResponse: null });
        return;
      }

      const preloaded = learnQueue.preloadedSessions[nextIndex];
      if (preloaded) {
        set({
          session: preloaded,
          phase: "awaiting_input",
          lastResponse: null,
          learnQueue: { ...learnQueue, currentIndex: nextIndex },
        });
        return;
      }

      set({ phase: "loading", error: null });
      try {
        const { subject } = get();
        const session = await createSession(learnQueue.problems[nextIndex], "learn", subject);
        set({
          session,
          phase: "awaiting_input",
          lastResponse: null,
          learnQueue: { ...learnQueue, currentIndex: nextIndex },
        });
      } catch (e) {
        set({ phase: "error", error: (e as Error).message });
      }
    },

    toggleLearnFlag: (index: number) => {
      const { learnQueue } = get();
      if (!learnQueue) return;
      const newFlags = [...learnQueue.flags];
      newFlags[index] = !newFlags[index];
      set({ learnQueue: { ...learnQueue, flags: newFlags } });
    },

    practiceFlaggedFromLearnQueue: async () => {
      const { learnQueue, subject } = get();
      if (!learnQueue) return;

      const flaggedProblems = learnQueue.problems.filter((_, i) => learnQueue.flags[i]);
      if (flaggedProblems.length === 0) return;

      set({ ...initialState, subject, phase: "loading" });
      try {
        const [results, sessionId] = await Promise.all([
          Promise.all(flaggedProblems.map((p) => generatePracticeProblems(p, 1, subject))),
          createPracticeBatchSession(flaggedProblems[0]).then((r) => r.id).catch(() => null),
        ]);
        const practiceProblemsList = results.map((r) => r.problems[0]);

        set({
          practiceBatch: {
            problems: practiceProblemsList,
            currentIndex: 0,
            results: [],
            flags: new Array(practiceProblemsList.length).fill(false),
            loadingMore: false,
            totalCount: practiceProblemsList.length,
            skippedProblems: [],
            pendingChecks: 0,
            workSubmissions: new Array(practiceProblemsList.length).fill(null),
            firstAttemptCorrect: new Array(practiceProblemsList.length).fill(null),
            currentFeedback: null,
            sessionId,
          },
          phase: "awaiting_input",
        });
      } catch (e) {
        set({ phase: "error", error: (e as Error).message });
      }
    },

    submitAnswer: async (answer: string) => {
      const { session } = get();
      if (!session) return;

      set({ phase: "thinking", error: null });
      try {
        const resp = await respondToStep(session.id, answer);
        const updated = await getSession(session.id);
        const nextPhase: SessionPhase = resp.action === "completed" ? "completed" : "awaiting_input";
        set({ session: updated, lastResponse: resp, phase: nextPhase });
      } catch (e) {
        set({ phase: "error", error: (e as Error).message });
      }
    },

    advanceStep: async () => {
      const { session } = get();
      if (!session) return;

      set({ phase: "thinking", error: null });
      try {
        const resp = await respondToStep(session.id, "", true);
        const updated = await getSession(session.id);
        set({ session: updated, lastResponse: null, phase: "awaiting_input" });
      } catch (e) {
        set({ phase: "error", error: (e as Error).message });
      }
    },

    askAboutStep: async (question: string) => {
      const { session } = get();
      if (!session) return;

      set({ phase: "thinking", error: null });
      try {
        const resp = await respondToStep(session.id, question);
        const updated = await getSession(session.id);
        set({ session: updated, lastResponse: resp, phase: "awaiting_input" });
      } catch (e) {
        set({ phase: "error", error: (e as Error).message });
      }
    },

    switchToLearnMode: async () => {
      const { session, subject } = get();
      if (!session) return;

      const problem = session.problem;
      set({ ...initialState, subject, phase: "loading" });
      try {
        const newSession = await createSession(problem, "learn", subject);
        set({ session: newSession, phase: "awaiting_input", lastResponse: null, error: null });
      } catch (e) {
        set({ phase: "error", error: (e as Error).message });
      }
    },

    continueAsking: () => {
      set({ phase: "awaiting_input", lastResponse: null });
    },

    finishAsking: () => {
      set({ phase: "completed" });
    },

};
}
