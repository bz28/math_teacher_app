import {
  checkPracticeAnswer,
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

/** Show summary if all problems answered and all checks done */
function maybeShowSummary(get: StoreGet, set: StoreSet) {
  const { practiceBatch, phase } = get();
  if (!practiceBatch) return;
  const allAnswered = practiceBatch.results.length >= practiceBatch.problems.length && !practiceBatch.loadingMore;
  if (allAnswered && practiceBatch.pendingChecks <= 0 && phase !== "awaiting_input") {
    set({ phase: "practice_summary" });
  }
}

/** Subscribe to store changes and show summary when all checks complete */
function waitForChecksAndShowSummary(get: StoreGet, set: StoreSet, subscribe: StoreSubscribe) {
  const { practiceBatch } = get();
  if (!practiceBatch) return;
  if (practiceBatch.pendingChecks <= 0) {
    set({ phase: "practice_summary" });
    return;
  }
  const unsub = subscribe((state) => {
    if (!state.practiceBatch) { unsub(); return; }
    if (state.practiceBatch.pendingChecks <= 0) {
      unsub();
      set({ phase: "practice_summary" });
    }
  });
}

export function createPracticeActions(set: StoreSet, get: StoreGet, subscribe: StoreSubscribe) {
  return {
    startPracticeBatch: async (problem: string, similarCount: number) => {
      const { subject } = get();
      const needsMore = similarCount > 0;
      set({
        ...initialState,
        subject,
        practiceBatch: {
          problems: [{ question: problem, answer: "" }],
          currentIndex: 0,
          results: [],
          flags: [false],
          loadingMore: needsMore,
          totalCount: 1 + similarCount,
          skippedProblems: [],
          pendingChecks: 0,
          workSubmissions: [null],
        },
        phase: "awaiting_input",
      });

      // Resolve the correct answer in background
      generatePracticeProblems(problem, 0, subject)
        .then(({ problems: firstBatch }) => {
          const { practiceBatch } = get();
          if (!practiceBatch || !firstBatch[0]) return;
          const updated = [...practiceBatch.problems];
          updated[0] = { question: problem, answer: firstBatch[0].answer };
          set({ practiceBatch: { ...practiceBatch, problems: updated } });
        })
        .catch(() => {
          set({ phase: "error", error: "Failed to solve problem" });
        });

      // Generate remaining similar problems in the background
      if (needsMore) {
        generatePracticeProblems(problem, similarCount, subject)
          .then(({ problems: remaining }) => {
            const { practiceBatch } = get();
            if (!practiceBatch) return;
            const newProblems = [
              ...practiceBatch.problems,
              ...remaining.filter((p) => p.question !== problem),
            ];
            const addedCount = newProblems.length - practiceBatch.problems.length;
            set({
              practiceBatch: {
                ...practiceBatch,
                problems: newProblems,
                flags: [
                  ...practiceBatch.flags,
                  ...new Array(addedCount).fill(false),
                ],
                workSubmissions: [
                  ...practiceBatch.workSubmissions,
                  ...new Array(addedCount).fill(null),
                ],
                loadingMore: false,
              },
            });
          })
          .catch(() => {
            const { practiceBatch } = get();
            if (practiceBatch) {
              set({ practiceBatch: { ...practiceBatch, loadingMore: false } });
            }
          });
      }
    },

    startPracticeQueue: async (problems: string[]) => {
      if (problems.length === 0) return;
      const { subject } = get();

      const placeholders: PracticeProblem[] = problems.map((p) => ({ question: p, answer: "" }));
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
      const { practiceBatch } = get();
      if (!practiceBatch) return;

      const current = practiceBatch.problems[practiceBatch.currentIndex];
      const answerIndex = practiceBatch.currentIndex;
      const nextIndex = answerIndex + 1;
      const hasMoreProblems = nextIndex < practiceBatch.problems.length;

      const placeholder: PracticeResult = {
        problem: current.question,
        userAnswer: answer,
        correctAnswer: current.answer,
        isCorrect: false,
      };
      const newResults = [...practiceBatch.results, placeholder];

      if (hasMoreProblems) {
        set({
          practiceBatch: {
            ...practiceBatch,
            results: newResults,
            currentIndex: nextIndex,
            pendingChecks: practiceBatch.pendingChecks + 1,
          },
          phase: "awaiting_input",
          error: null,
        });
      } else if (practiceBatch.loadingMore) {
        set({
          practiceBatch: {
            ...practiceBatch,
            results: newResults,
            pendingChecks: practiceBatch.pendingChecks + 1,
          },
          phase: "loading",
        });
        const unsub = subscribe((state) => {
          if (!state.practiceBatch) { unsub(); return; }
          if (state.practiceBatch.problems.length > nextIndex) {
            unsub();
            set({
              practiceBatch: { ...state.practiceBatch, currentIndex: nextIndex },
              phase: "awaiting_input",
            });
          } else if (!state.practiceBatch.loadingMore) {
            unsub();
            waitForChecksAndShowSummary(get, set, subscribe);
          }
        });
      } else {
        set({
          practiceBatch: {
            ...practiceBatch,
            results: newResults,
            pendingChecks: practiceBatch.pendingChecks + 1,
          },
          phase: "loading",
        });
      }

      // Wait for correct answer to be resolved if needed, then check
      const getCorrectAnswer = (): Promise<string> => {
        const batch = get().practiceBatch;
        const correctAnswer = batch?.problems[answerIndex]?.answer;
        if (correctAnswer) return Promise.resolve(correctAnswer);
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            unsub();
            reject(new Error("Timed out waiting for correct answer"));
          }, 30_000);
          const unsub = subscribe((state) => {
            const ca = state.practiceBatch?.problems[answerIndex]?.answer;
            if (ca) { clearTimeout(timeout); unsub(); resolve(ca); }
          });
        });
      };

      const { subject: subjectForCheck } = get();
      getCorrectAnswer().then((correctAnswer) =>
        checkPracticeAnswer(current.question, correctAnswer, answer, subjectForCheck)
          .then(({ is_correct }) => {
            const { practiceBatch: batch } = get();
            if (!batch) return;

            const updatedResults = [...batch.results];
            updatedResults[answerIndex] = { ...updatedResults[answerIndex], isCorrect: is_correct };

            const updatedFlags = [...batch.flags];
            if (!is_correct) {
              updatedFlags[answerIndex] = true;
            }

            const remaining = batch.pendingChecks - 1;
            set({
              practiceBatch: {
                ...batch,
                results: updatedResults,
                flags: updatedFlags,
                pendingChecks: remaining,
              },
            });

            maybeShowSummary(get, set);
          })
          .catch(() => {
            const { practiceBatch: batch } = get();
            if (!batch) return;
            set({
              practiceBatch: {
                ...batch,
                pendingChecks: batch.pendingChecks - 1,
              },
            });
            maybeShowSummary(get, set);
          })
      );
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
        const results = await Promise.all(
          flaggedQuestions.map((q) => generatePracticeProblems(q, 1, subject)),
        );
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
