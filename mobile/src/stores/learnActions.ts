import {
  createPracticeBatchSession,
  createSession,
  generatePracticeProblems,
  getSession,
  respondToStep,
} from "../services/api";
import { errorMessage } from "../utils/errorMessage";
import { initialState, type SessionPhase, type StoreGet, type StoreSet } from "./types";

export function createLearnActions(set: StoreSet, get: StoreGet) {
  return {
    startSession: async (problem: string, mode = "learn") => {
      const { subject, problemImages } = get();
      const image = problemImages[problem];
      set({ phase: "loading", error: null });
      try {
        const session = await createSession(problem, mode, subject, image);
        set({ session, phase: "awaiting_input", lastResponse: null });
      } catch (e) {
        set({ phase: "error", error: errorMessage(e) });
      }
    },

    resumeSession: async (sessionId: string) => {
      set({ phase: "loading", error: null });
      try {
        const session = await getSession(sessionId);
        set({ session, phase: "awaiting_input", lastResponse: null, subject: session.subject });
      } catch (e) {
        set({ phase: "error", error: errorMessage(e) });
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
        set({ phase: "error", error: errorMessage(e) });
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
        set({ phase: "error", error: errorMessage(e) });
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
            answers: {},
            flags: new Array(practiceProblemsList.length).fill(false),
            currentIndex: 0,
            startedAt: Date.now(),
            submittedAt: null,
            results: null,
            sessionId,
          },
          phase: "practice_active",
        });
      } catch (e) {
        set({ phase: "error", error: errorMessage(e) });
      }
    },

    advanceStep: async () => {
      const { session } = get();
      if (!session) return;

      set({ phase: "thinking", error: null });
      try {
        const resp = await respondToStep(session.id, "", true);
        const updated = await getSession(session.id);
        // If the backend marked the session completed (last step advanced),
        // land directly on the completion phase instead of forcing the user
        // to tap "I get it" a second time.
        const isDone = resp.action === "completed" || updated.status === "completed";
        set({
          session: updated,
          lastResponse: null,
          phase: isDone ? "completed" : "awaiting_input",
        });
      } catch (e) {
        set({ phase: "error", error: errorMessage(e) });
      }
    },

    askAboutStep: async (question: string) => {
      const { session, chatHistory } = get();
      if (!session) return;

      const stepIndex = session.current_step;
      // Optimistically append the user message before the API round-trip
      const existing = chatHistory[stepIndex] ?? [];
      set({
        phase: "thinking",
        error: null,
        chatHistory: {
          ...chatHistory,
          [stepIndex]: [...existing, { role: "user", text: question }],
        },
      });

      try {
        const resp = await respondToStep(session.id, question);
        const updated = await getSession(session.id);
        const latest = get().chatHistory;
        const stepHistory = latest[stepIndex] ?? [];
        set({
          session: updated,
          lastResponse: resp,
          phase: "awaiting_input",
          chatHistory: {
            ...latest,
            [stepIndex]: [...stepHistory, { role: "tutor", text: resp.feedback }],
          },
        });
      } catch (e) {
        set({ phase: "error", error: errorMessage(e) });
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
        set({ phase: "error", error: errorMessage(e) });
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
