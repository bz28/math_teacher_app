import {
  checkPracticeAnswer,
  completeMockTestSession,
  createMockTestSession,
  EntitlementError,
  generatePracticeProblems,
  submitWork,
  type PracticeProblem,
} from "../services/api";
import { errorMessage } from "../utils/errorMessage";
import {
  initialState,
  type QuizResult,
  type StoreGet,
  type StoreSet,
  type StoreSubscribe,
} from "./types";

export function createMockTestActions(set: StoreSet, get: StoreGet, subscribe: StoreSubscribe) {
  return {
    startMockTest: async (problems: string[], generateCount: number, timeLimitMinutes: number | null, multipleChoice: boolean = true) => {
      const { subject } = get();
      if (generateCount > 0) {
        set({ ...initialState, subject, phase: "loading" });
        try {
          // Pass the sources as a list and let the backend round-robin so a
          // 3-source / 10-question request produces ~3-4 similar problems for
          // each source instead of 10 variations of one concatenated blob.
          const { problems: generated } = await generatePracticeProblems(problems, generateCount, subject);
          if (generated.length === 0) throw new Error("Failed to generate exam questions");

          // /practice/generate (count > 0) returns question text only —
          // answer + distractors come back empty. Solve each question in
          // parallel and AWAIT all of them before flipping to
          // mock_test_active, so the student never sees "Loading choices"
          // on any question (which used to happen if they nav'd ahead
          // before the backfill resolved).
          const solveResults = await Promise.allSettled(
            generated.map((q) =>
              generatePracticeProblems(q.question, 0, subject).then((res) => res.problems[0]),
            ),
          );
          const fullQuestions = generated.map((q, i) => {
            const r = solveResults[i];
            if (r.status === "fulfilled" && r.value) {
              // Keep the freshly-generated question text — solve_problem
              // sometimes lightly reformats it; the student should see
              // exactly what they were shown during generation.
              return { ...r.value, question: q.question };
            }
            // Per-question failure: render with empty distractors. The MC
            // grid degrades to "Loading choices" for that single item
            // rather than dragging the whole test back to loading.
            return q;
          });

          set({
            mockTest: {
              sessionId: null,
              questions: fullQuestions,
              answers: {},
              flags: new Array(fullQuestions.length).fill(false),
              currentIndex: 0,
              timeLimitSeconds: timeLimitMinutes != null ? timeLimitMinutes * 60 : null,
              startedAt: Date.now(),
              submittedAt: null,
              results: null,
              workImages: new Array(fullQuestions.length).fill(null),
              workSubmissions: new Array(fullQuestions.length).fill(null),
              multipleChoice,
            },
            phase: "mock_test_active",
          });

          const allQuestions = fullQuestions.map((q) => q.question);
          createMockTestSession(allQuestions.join("\n"), allQuestions)
            .then(({ id }) => {
              const current = get().mockTest;
              if (current) set({ mockTest: { ...current, sessionId: id } });
            })
            .catch(() => {});
        } catch (e) {
          if (e instanceof EntitlementError) throw e;
          set({ phase: "error", error: errorMessage(e) });
        }
        return;
      }

      // "Use as exam" mode — show questions immediately, resolve answers in background
      const questions: PracticeProblem[] = problems.map((p) => ({ question: p, answer: "" }));

      set({
        ...initialState,
        subject,
        mockTest: {
          sessionId: null,
          questions,
          answers: {},
          flags: new Array(questions.length).fill(false),
          currentIndex: 0,
          timeLimitSeconds: timeLimitMinutes != null ? timeLimitMinutes * 60 : null,
          startedAt: Date.now(),
          submittedAt: null,
          results: null,
          workImages: new Array(questions.length).fill(null),
          workSubmissions: new Array(questions.length).fill(null),
          multipleChoice,
        },
        phase: "loading",
      });

      // Solve every question in parallel and AWAIT all of them before
      // flipping to mock_test_active. Previously we only awaited the
      // first solve, which meant nav'ing ahead before the rest finished
      // showed "Loading choices" on later questions.
      const solveResults = await Promise.allSettled(
        problems.map((p) =>
          generatePracticeProblems(p, 0, subject).then((res) => res.problems[0]),
        ),
      );
      const mt = get().mockTest;
      if (mt) {
        const updated = mt.questions.map((q, i) => {
          const r = solveResults[i];
          if (r.status === "fulfilled" && r.value) {
            // Preserve the literal source problem text as the question.
            return { ...r.value, question: q.question };
          }
          return q;
        });
        set({ mockTest: { ...mt, questions: updated }, phase: "mock_test_active" });
      } else {
        set({ phase: "mock_test_active" });
      }

      // Fire-and-forget: track session for analytics
      const allQuestions = questions.map((q) => q.question);
      createMockTestSession(allQuestions.join("\n"), allQuestions)
        .then(({ id }) => {
          const current = get().mockTest;
          if (current) set({ mockTest: { ...current, sessionId: id } });
        })
        .catch(() => {});
    },

    saveMockTestAnswer: (index: number, answer: string) => {
      const { mockTest } = get();
      if (!mockTest) return;
      set({
        mockTest: {
          ...mockTest,
          answers: { ...mockTest.answers, [index]: answer },
        },
      });
    },

    navigateMockQuestion: (index: number) => {
      const { mockTest } = get();
      if (!mockTest) return;
      set({ mockTest: { ...mockTest, currentIndex: index } });
    },

    toggleMockTestFlag: (index: number) => {
      const { mockTest } = get();
      if (!mockTest) return;
      const newFlags = [...mockTest.flags];
      newFlags[index] = !newFlags[index];
      set({ mockTest: { ...mockTest, flags: newFlags } });
    },

    submitMockTest: async () => {
      const { mockTest } = get();
      if (!mockTest) return;

      set({ phase: "loading" });
      try {
        // Wait for all correct answers to be resolved
        const answersResolved = mockTest.questions.every((q) => q.answer !== "");
        if (!answersResolved) {
          await new Promise<void>((resolve) => {
            const unsub = subscribe((state) => {
              if (!state.mockTest) { unsub(); resolve(); return; }
              if (state.mockTest.questions.every((q) => q.answer !== "")) {
                unsub();
                resolve();
              }
            });
          });
        }

        // Re-read after potential wait
        const mt = get().mockTest;
        if (!mt) return;

        // Batch check all answered questions
        const checkPromises = mt.questions.map(async (q, i) => {
          const userAnswer = mt.answers[i];
          if (!userAnswer) {
            return { question: q.question, userAnswer: null, correctAnswer: q.answer, isCorrect: null };
          }

          // MC mode: student selected an exact option, no API call needed
          if (mt.multipleChoice) {
            return { question: q.question, userAnswer, correctAnswer: q.answer, isCorrect: userAnswer.trim() === q.answer.trim() };
          }

          // Free response: try exact match first to skip API call
          if (userAnswer.trim() === q.answer.trim()) {
            return { question: q.question, userAnswer, correctAnswer: q.answer, isCorrect: true };
          }

          // Fall back to API for semantic equivalence check
          try {
            const { is_correct } = await checkPracticeAnswer(q.question, q.answer, userAnswer, get().subject);
            return { question: q.question, userAnswer, correctAnswer: q.answer, isCorrect: is_correct };
          } catch {
            return { question: q.question, userAnswer, correctAnswer: q.answer, isCorrect: false };
          }
        });

        const results: QuizResult[] = await Promise.all(checkPromises);
        const currentMockTest = get().mockTest;
        if (!currentMockTest) return;

        // Auto-flag incorrect and skipped questions
        const newFlags = [...currentMockTest.flags];
        results.forEach((r, i) => {
          if (r.isCorrect !== true) newFlags[i] = true;
        });

        // Record completion for analytics (fire-and-forget)
        const correctCount = results.filter((r) => r.isCorrect === true).length;
        if (currentMockTest.sessionId) {
          completeMockTestSession(currentMockTest.sessionId, results.length, correctCount).catch(() => {});
        }

        set({
          mockTest: { ...currentMockTest, results, flags: newFlags, submittedAt: Date.now() },
          phase: "mock_test_summary",
        });

        // Fire work diagnosis for attached images (background, capped at 3 concurrent)
        const imagesToDiagnose = currentMockTest.workImages
          .map((img, i) => img ? { index: i, image: img } : null)
          .filter((x): x is { index: number; image: string } => x !== null);

        if (imagesToDiagnose.length > 0) {
          const CONCURRENCY = 3;
          const processChunk = async (chunk: typeof imagesToDiagnose) => {
            await Promise.allSettled(
              chunk.map(async ({ index, image }) => {
                try {
                  const q = currentMockTest.questions[index];
                  const r = results[index];
                  const resp = await submitWork(
                    image,
                    q.question,
                    r?.userAnswer ?? "",
                    r?.isCorrect === true,
                    get().subject,
                  );
                  const latestMt = get().mockTest;
                  if (!latestMt || !resp.diagnosis) return;

                  const diagnosis = resp.diagnosis;
                  const newSubs = [...latestMt.workSubmissions];
                  newSubs[index] = diagnosis;
                  const updatedFlags = [...latestMt.flags];
                  if (diagnosis.has_issues && !updatedFlags[index]) {
                    updatedFlags[index] = true;
                  }
                  set({ mockTest: { ...latestMt, workSubmissions: newSubs, flags: updatedFlags } });
                } catch {
                  // Diagnosis failed silently
                }
              }),
            );
          };

          for (let i = 0; i < imagesToDiagnose.length; i += CONCURRENCY) {
            await processChunk(imagesToDiagnose.slice(i, i + CONCURRENCY));
          }
        }
      } catch (e) {
        set({ phase: "error", error: errorMessage(e) });
      }
    },

    attachWorkImage: (index: number, imageBase64: string) => {
      const { mockTest } = get();
      if (!mockTest) return;
      const newImages = [...mockTest.workImages];
      newImages[index] = imageBase64;
      set({ mockTest: { ...mockTest, workImages: newImages } });
    },
  };
}
