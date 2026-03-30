import {
  checkPracticeAnswer,
  completePracticeBatchSession,
  createPracticeBatchSession,
  generatePracticeProblems,
  submitWork,
  type PracticeProblem,
} from "../services/api";
import {
  initialState,
  type PracticeResult,
  type StoreGet,
  type StoreSet,
  type StoreSubscribe,
} from "./types";

export function createPracticeActions(set: StoreSet, get: StoreGet, subscribe: StoreSubscribe) {
  return {
    startPracticeBatch: async (problem: string, count: number) => {
      const { subject } = get();
      set({ ...initialState, subject, phase: "loading" });
      try {
        const [{ problems }, { id: sessionId }] = await Promise.all([
          generatePracticeProblems(problem, count, subject),
          createPracticeBatchSession(problem),
        ]);
        set({
          practiceBatch: {
            problems,
            currentIndex: 0,
            results: [],
            flags: new Array(problems.length).fill(false),
            loadingMore: false,
            totalCount: problems.length,
            skippedProblems: [],
            pendingChecks: 0,
            workSubmissions: new Array(problems.length).fill(null),
            firstAttemptCorrect: new Array(problems.length).fill(null),
            currentFeedback: null,
            sessionId,
          },
          phase: "awaiting_input",
        });
      } catch {
        set({ phase: "error", error: "Failed to generate practice problems" });
      }
    },

    startPracticeQueue: async (problems: string[]) => {
      if (problems.length === 0) return;
      const { subject } = get();

      const placeholders: PracticeProblem[] = problems.map((p) => ({ question: p, answer: "" }));
      const sessionId = await createPracticeBatchSession(problems[0]).then((r) => r.id).catch(() => null);
      set({
        ...initialState,
        subject,
        practiceBatch: {
          problems: placeholders,
          currentIndex: 0,
          results: [],
          flags: new Array(problems.length).fill(false),
          loadingMore: false,
          totalCount: problems.length,
          skippedProblems: [],
          pendingChecks: 0,
          workSubmissions: new Array(problems.length).fill(null),
          firstAttemptCorrect: new Array(problems.length).fill(null),
          currentFeedback: null,
          sessionId,
        },
        phase: "awaiting_input",
      });

      // Resolve all answers in background
      Promise.allSettled(
        problems.map((p) => generatePracticeProblems(p, 0, subject)),
      )
        .then((outcomes) => {
          const { practiceBatch } = get();
          if (!practiceBatch) return;
          const updated = [...practiceBatch.problems];
          const skipped: string[] = [];
          for (let i = 0; i < outcomes.length; i++) {
            const outcome = outcomes[i];
            if (outcome.status === "fulfilled" && outcome.value.problems[0]) {
              updated[i] = { question: problems[i], answer: outcome.value.problems[0].answer };
            } else {
              skipped.push(problems[i]);
            }
          }
          set({
            practiceBatch: {
              ...practiceBatch,
              problems: updated,
              skippedProblems: skipped,
            },
          });
        });
    },

    submitPracticeAnswer: async (answer: string) => {
      const { practiceBatch, subject } = get();
      if (!practiceBatch) return;

      const idx = practiceBatch.currentIndex;
      const current = practiceBatch.problems[idx];

      set({ phase: "thinking", error: null });

      // Wait for correct answer to be resolved if needed (queue mode)
      const getCorrectAnswer = (): Promise<string> => {
        const batch = get().practiceBatch;
        const correctAnswer = batch?.problems[idx]?.answer;
        if (correctAnswer) return Promise.resolve(correctAnswer);
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            unsub();
            reject(new Error("Timed out waiting for correct answer"));
          }, 30_000);
          const unsub = subscribe((state) => {
            const ca = state.practiceBatch?.problems[idx]?.answer;
            if (ca) { clearTimeout(timeout); unsub(); resolve(ca); }
          });
        });
      };

      try {
        const correctAnswer = await getCorrectAnswer();
        const { is_correct } = await checkPracticeAnswer(
          current.question, correctAnswer, answer, subject,
        );

        const batch = get().practiceBatch;
        if (!batch) return;

        // Track first-attempt result
        const newFirstAttempt = [...batch.firstAttemptCorrect];
        if (newFirstAttempt[idx] === null) newFirstAttempt[idx] = is_correct;

        if (is_correct) {
          const result: PracticeResult = {
            problem: current.question,
            userAnswer: answer,
            correctAnswer: "",
            isCorrect: true,
          };
          const newResults = [...batch.results, result];
          const newFlags = [...batch.flags];
          newFlags[idx] = false;
          const nextIndex = idx + 1;
          const isLast = nextIndex >= batch.problems.length && !batch.loadingMore;

          set({
            practiceBatch: {
              ...batch,
              results: newResults,
              flags: newFlags,
              firstAttemptCorrect: newFirstAttempt,
              currentFeedback: "correct",
              currentIndex: isLast ? idx : nextIndex,
            },
            phase: isLast ? "practice_summary" : "awaiting_input",
          });
        } else {
          const newFlags = [...batch.flags];
          newFlags[idx] = true;

          set({
            practiceBatch: {
              ...batch,
              flags: newFlags,
              firstAttemptCorrect: newFirstAttempt,
              currentFeedback: "wrong",
            },
            phase: "awaiting_input",
          });
        }
      } catch {
        set({ phase: "error", error: "Failed to check answer" });
      }
    },

    skipPracticeProblem: () => {
      const { practiceBatch } = get();
      if (!practiceBatch) return;
      const idx = practiceBatch.currentIndex;
      const current = practiceBatch.problems[idx];

      const newFlags = [...practiceBatch.flags];
      newFlags[idx] = true;
      const newFirstAttempt = [...practiceBatch.firstAttemptCorrect];
      if (newFirstAttempt[idx] === null) newFirstAttempt[idx] = false;

      const result: PracticeResult = {
        problem: current.question,
        userAnswer: "(skipped)",
        correctAnswer: "",
        isCorrect: false,
      };

      const next = idx + 1;
      const isLast = next >= practiceBatch.problems.length && !practiceBatch.loadingMore;

      set({
        practiceBatch: {
          ...practiceBatch,
          results: [...practiceBatch.results, result],
          flags: newFlags,
          firstAttemptCorrect: newFirstAttempt,
          currentFeedback: null,
          currentIndex: isLast ? idx : next,
        },
        phase: isLast ? "practice_summary" : "awaiting_input",
      });
    },

    togglePracticeFlag: (index: number) => {
      const { practiceBatch } = get();
      if (!practiceBatch) return;
      const newFlags = [...practiceBatch.flags];
      newFlags[index] = !newFlags[index];
      set({ practiceBatch: { ...practiceBatch, flags: newFlags } });
    },

    retryFlaggedProblems: async () => {
      const { practiceBatch, subject } = get();
      if (!practiceBatch) return;

      const flaggedQuestions = practiceBatch.problems
        .filter((_, i) => practiceBatch.flags[i])
        .map((p) => p.question);
      if (flaggedQuestions.length === 0) return;

      set({ ...initialState, subject, phase: "loading" });
      try {
        const [results, sessionId] = await Promise.all([
          Promise.all(flaggedQuestions.map((q) => generatePracticeProblems(q, 1, subject))),
          createPracticeBatchSession(flaggedQuestions[0]).then((r) => r.id).catch(() => null),
        ]);
        const similarProblems = results.map((r) => r.problems[0]);

        set({
          practiceBatch: {
            problems: similarProblems,
            currentIndex: 0,
            results: [],
            flags: new Array(similarProblems.length).fill(false),
            loadingMore: false,
            totalCount: similarProblems.length,
            skippedProblems: [],
            pendingChecks: 0,
            workSubmissions: new Array(similarProblems.length).fill(null),
            firstAttemptCorrect: new Array(similarProblems.length).fill(null),
            currentFeedback: null,
            sessionId,
          },
          phase: "awaiting_input",
          error: null,
        });
      } catch (e) {
        set({ phase: "error", error: (e as Error).message });
      }
    },

    submitPracticeWork: (index: number, imageBase64: string, userAnswer: string) => {
      const { practiceBatch } = get();
      if (!practiceBatch) return;

      const problem = practiceBatch.problems[index];
      if (!problem) return;

      submitWork(imageBase64, problem.question, userAnswer, false, get().subject)
        .then((resp) => {
          const { practiceBatch: batch } = get();
          if (!batch || !resp.diagnosis) return;

          const diagnosis = resp.diagnosis;
          const newSubmissions = [...batch.workSubmissions];
          newSubmissions[index] = diagnosis;

          const newFlags = [...batch.flags];
          if (diagnosis.has_issues && !newFlags[index]) {
            newFlags[index] = true;
          }

          set({
            practiceBatch: {
              ...batch,
              workSubmissions: newSubmissions,
              flags: newFlags,
            },
          });
        })
        .catch(() => {});
    },
  };
}
