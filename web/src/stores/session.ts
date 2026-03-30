"use client";

import { create } from "zustand";
import {
  session as sessionApi,
  practice as practiceApi,
  work as workApi,
  type SessionResponse,
  type StepResponse,
  type PracticeProblem,
  type PracticeCheckResponse,
  type DiagnosisResult,
} from "@/lib/api";

// ── Types ──

export type SessionPhase =
  | "idle"
  | "loading"
  | "awaiting_input"
  | "thinking"
  | "completed"
  | "practice_summary"
  | "learn_summary"
  | "mock_test_active"
  | "mock_test_summary"
  | "error";

export type Subject = "math" | "chemistry";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface LearnQueue {
  problems: string[];
  currentIndex: number;
  flags: boolean[];
  preloadedSessions: Record<number, SessionResponse>;
}

export interface PracticeBatch {
  problems: PracticeProblem[];
  currentIndex: number;
  results: PracticeResult[];
  flags: boolean[];
  workSubmissions: (DiagnosisResult | null)[];
  firstAttemptCorrect: (boolean | null)[];
  currentFeedback: 'correct' | 'wrong' | null;
  sessionId: string | null;
  /** True while additional problems are being generated in background */
  loadingMore: boolean;
  /** Total number of problems expected */
  totalCount: number;
  /** Problems that failed to process */
  skippedProblems: string[];
}

export interface PracticeResult {
  problem: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
}

export interface MockTest {
  questions: PracticeProblem[];
  answers: Record<number, string>;
  flags: boolean[];
  currentIndex: number;
  timeLimitSeconds: number | null;
  startedAt: number;
  submittedAt: number | null;
  results: MockTestResult[] | null;
  sessionId: string | null;
  workImages: (string | null)[];
  workSubmissions: (DiagnosisResult | null)[];
}

export interface MockTestResult {
  question: string;
  userAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean | null;
}

// ── Store ──

interface SessionState {
  // Core session
  session: SessionResponse | null;
  /** Cropped image for the current session (client-side only) */
  sessionImage: string | null;
  phase: SessionPhase;
  lastResponse: StepResponse | null;
  error: string | null;
  subject: Subject;

  // Step chat
  chatHistory: Record<number, ChatMessage[]>;

  // Learn queue
  learnQueue: LearnQueue | null;

  // Practice batch
  practiceBatch: PracticeBatch | null;

  // Mock test
  mockTest: MockTest | null;

  // Problem input
  problemQueue: { text: string; image?: string }[];

  // Actions
  setSubject: (subject: Subject) => void;
  setProblemQueue: (queue: { text: string; image?: string }[]) => void;
  addToQueue: (problem: string, image?: string) => void;
  removeFromQueue: (index: number) => void;

  // Learn actions
  startSession: (problem: string, image?: string) => Promise<void>;
  resumeSession: (sessionId: string) => Promise<void>;
  submitAnswer: (answer: string) => Promise<void>;
  advanceStep: () => Promise<void>;
  askAboutStep: (question: string) => Promise<void>;

  // Learn completion actions
  continueAsking: () => void;
  finishAsking: () => void;


  // Learn queue actions
  startLearnQueue: (problems: string[]) => Promise<void>;
  advanceLearnQueue: () => Promise<void>;
  toggleLearnFlag: (index: number) => void;
  practiceFlaggedFromLearnQueue: () => Promise<void>;

  // Practice actions
  startPracticeBatch: (problem: string, count: number) => Promise<void>;
  submitPracticeAnswer: (answer: string) => Promise<void>;
  skipPracticeProblem: () => void;
  submitPracticeWork: (index: number, imageBase64: string, userAnswer: string) => void;
  nextPracticeProblem: () => void;
  togglePracticeFlag: (index: number) => void;
  retryFlaggedProblems: () => Promise<void>;

  // Mock test actions
  startMockTest: (problems: string[], generateCount: number, timeLimitMinutes: number | null) => Promise<void>;
  saveMockTestAnswer: (index: number, answer: string) => void;
  attachMockTestWork: (index: number, imageBase64: string) => void;
  toggleMockTestFlag: (index: number) => void;
  setMockTestIndex: (index: number) => void;
  submitMockTest: () => Promise<void>;

  // Reset
  reset: () => void;
}

const initialState = {
  session: null,
  sessionImage: null,
  phase: "idle" as SessionPhase,
  lastResponse: null,
  error: null,
  subject: "math" as Subject,
  chatHistory: {},
  learnQueue: null,
  practiceBatch: null,
  mockTest: null,
  problemQueue: [],
};

export const useSessionStore = create<SessionState>((set, get) => ({
  ...initialState,

  setSubject(subject) {
    set({ subject });
  },

  setProblemQueue(queue) {
    set({ problemQueue: queue });
  },

  addToQueue(problem, image) {
    const { problemQueue } = get();
    if (problemQueue.length < 10) {
      set({ problemQueue: [...problemQueue, { text: problem, image }] });
    }
  },

  removeFromQueue(index) {
    const { problemQueue } = get();
    set({ problemQueue: problemQueue.filter((_, i) => i !== index) });
  },

  // ── Learn session ──

  async startSession(problem, image) {
    const { subject } = get();
    set({ phase: "loading", error: null });
    try {
      const session = await sessionApi.create({
        problem,
        mode: "learn",
        subject,
        ...(image && { image_base64: image }),
      });
      set({ session, sessionImage: image ?? null, phase: "awaiting_input", chatHistory: {} });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async resumeSession(sessionId) {
    // Clear all stale state before resuming
    set({ ...initialState, phase: "loading" as SessionPhase, error: null });
    try {
      const session = await sessionApi.get(sessionId);
      set({ session, phase: "awaiting_input", chatHistory: {}, subject: session.subject as Subject });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async submitAnswer(answer) {
    const { session } = get();
    if (!session) return;
    set({ phase: "thinking" });
    try {
      const response = await sessionApi.respond(session.id, {
        student_response: answer,
        request_advance: false,
      });
      // Re-fetch session to get updated steps/choices (matches mobile)
      const updated = await sessionApi.get(session.id);
      const nextPhase = response.action === "completed" ? "completed" : "awaiting_input";
      set({ session: updated, lastResponse: response, phase: nextPhase as SessionPhase });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async advanceStep() {
    const { session } = get();
    if (!session) return;
    set({ phase: "thinking" });
    try {
      await sessionApi.respond(session.id, {
        student_response: "",
        request_advance: true,
      });
      // Re-fetch session to get updated steps/choices (matches mobile)
      const updated = await sessionApi.get(session.id);
      set({ session: updated, lastResponse: null, phase: "awaiting_input" });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async askAboutStep(question) {
    const { session } = get();
    if (!session) return;
    // Clamp to valid range to match UI key (stepIndex)
    const stepNum = Math.min(session.current_step, session.total_steps - 1);

    // Add user message to chat and set thinking
    set((state) => ({
      phase: "thinking" as SessionPhase,
      chatHistory: {
        ...state.chatHistory,
        [stepNum]: [
          ...(state.chatHistory[stepNum] ?? []),
          { role: "user" as const, text: question },
        ],
      },
    }));

    try {
      const response = await sessionApi.respond(session.id, {
        student_response: question,
        request_advance: false,
      });
      // Re-fetch session and add AI message to chat
      const updated = await sessionApi.get(session.id);
      set((state) => ({
        session: updated,
        phase: "awaiting_input" as SessionPhase,
        chatHistory: {
          ...state.chatHistory,
          [stepNum]: [
            ...(state.chatHistory[stepNum] ?? []),
            { role: "assistant" as const, text: response.feedback },
          ],
        },
        lastResponse: response,
      }));
    } catch (err) {
      set({ phase: "awaiting_input" as SessionPhase, error: (err as Error).message });
    }
  },

  // ── Learn queue ──

  async startLearnQueue(problems) {
    const { problemQueue } = get();
    // Build image lookup from queue
    const imageMap = new Map(problemQueue.map((p) => [p.text, p.image]));

    set({
      learnQueue: {
        problems,
        currentIndex: 0,
        flags: new Array(problems.length).fill(false),
        preloadedSessions: {},
      },
    });
    // Start first session
    await get().startSession(problems[0], imageMap.get(problems[0]));

    // Preload remaining sessions in background
    if (problems.length > 1) {
      const { subject } = get();
      problems.slice(1).forEach((p, i) => {
        const queueIndex = i + 1;
        const image = imageMap.get(p);
        sessionApi.create({
          problem: p,
          mode: "learn",
          subject,
          ...(image && { image_base64: image }),
        })
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
  },

  async advanceLearnQueue() {
    const { learnQueue } = get();
    if (!learnQueue) return;
    const nextIndex = learnQueue.currentIndex + 1;
    if (nextIndex >= learnQueue.problems.length) {
      set({ phase: "learn_summary" });
      return;
    }

    const preloaded = learnQueue.preloadedSessions[nextIndex];
    if (preloaded) {
      set({
        session: preloaded,
        phase: "awaiting_input",
        lastResponse: null,
        chatHistory: {},
        learnQueue: { ...learnQueue, currentIndex: nextIndex },
      });
      return;
    }

    // Fallback: generate on the fly if preload didn't finish
    set({
      learnQueue: { ...learnQueue, currentIndex: nextIndex },
      session: null,
      lastResponse: null,
      chatHistory: {},
    });
    await get().startSession(learnQueue.problems[nextIndex]);
  },

  // ── Learn completion ──

  continueAsking() {
    set({ phase: "awaiting_input" as SessionPhase, lastResponse: null });
  },

  finishAsking() {
    set({ phase: "completed" as SessionPhase });
  },


  toggleLearnFlag(index) {
    const { learnQueue } = get();
    if (!learnQueue) return;
    const newFlags = [...learnQueue.flags];
    newFlags[index] = !newFlags[index];
    set({ learnQueue: { ...learnQueue, flags: newFlags } });
  },

  async practiceFlaggedFromLearnQueue() {
    const { learnQueue, subject } = get();
    if (!learnQueue) return;
    const flaggedProblems = learnQueue.problems.filter((_, i) => learnQueue.flags[i]);
    if (flaggedProblems.length === 0) return;

    set({ ...initialState, subject, phase: "loading" as SessionPhase });
    try {
      const allProblems: PracticeProblem[] = [];
      for (const problem of flaggedProblems) {
        const { problems } = await practiceApi.generate({ problem, count: 1, subject });
        allProblems.push(...problems);
      }
      const { id: sessionId } = await sessionApi.createPracticeBatch(flaggedProblems[0]);
      set({
        practiceBatch: {
          problems: allProblems,
          currentIndex: 0,
          results: [],
          flags: new Array(allProblems.length).fill(false),
          workSubmissions: new Array(allProblems.length).fill(null),
          firstAttemptCorrect: new Array(allProblems.length).fill(null),
          currentFeedback: null,
          sessionId,
          loadingMore: false,
          totalCount: 0,
          skippedProblems: [],
        },
        phase: "awaiting_input" as SessionPhase,
      });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  // ── Practice ──

  togglePracticeFlag(index) {
    const { practiceBatch } = get();
    if (!practiceBatch) return;
    const newFlags = [...practiceBatch.flags];
    newFlags[index] = !newFlags[index];
    set({ practiceBatch: { ...practiceBatch, flags: newFlags } });
  },

  async retryFlaggedProblems() {
    const { practiceBatch, subject } = get();
    if (!practiceBatch) return;
    const flaggedProblems = practiceBatch.problems.filter((_, i) => practiceBatch.flags[i]);
    if (flaggedProblems.length === 0) return;

    set({ ...initialState, subject, phase: "loading" as SessionPhase });
    try {
      const allProblems: PracticeProblem[] = [];
      for (const problem of flaggedProblems) {
        const { problems } = await practiceApi.generate({ problem: problem.question, count: 1, subject });
        allProblems.push(...problems);
      }
      const { id: sessionId } = await sessionApi.createPracticeBatch(flaggedProblems[0].question);
      set({
        practiceBatch: {
          problems: allProblems,
          currentIndex: 0,
          results: [],
          flags: new Array(allProblems.length).fill(false),
          workSubmissions: new Array(allProblems.length).fill(null),
          firstAttemptCorrect: new Array(allProblems.length).fill(null),
          currentFeedback: null,
          sessionId,
          loadingMore: false,
          totalCount: 0,
          skippedProblems: [],
        },
        phase: "awaiting_input" as SessionPhase,
      });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async startPracticeBatch(problem, count) {
    const { subject } = get();
    set({ phase: "loading", error: null });
    try {
      const [{ problems }, { id: sessionId }] = await Promise.all([
        practiceApi.generate({ problem, count, subject }),
        sessionApi.createPracticeBatch(problem),
      ]);
      set({
        practiceBatch: {
          problems,
          currentIndex: 0,
          results: [],
          flags: new Array(problems.length).fill(false),
          workSubmissions: new Array(problems.length).fill(null),
          firstAttemptCorrect: new Array(problems.length).fill(null),
          currentFeedback: null,
          sessionId,
          loadingMore: false,
          totalCount: 0,
          skippedProblems: [],
        },
        phase: "awaiting_input",
      });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async submitPracticeAnswer(answer) {
    const { practiceBatch, subject } = get();
    if (!practiceBatch) return;
    const idx = practiceBatch.currentIndex;
    const current = practiceBatch.problems[idx];
    set({ phase: "thinking" });
    try {
      // Wait for correct answer if still being resolved (queue mode)
      let correctAnswer = current.answer;
      if (!correctAnswer) {
        correctAnswer = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timed out")), 30_000);
          const check = () => {
            const batch = get().practiceBatch;
            const ans = batch?.problems[idx]?.answer;
            if (ans) { clearTimeout(timeout); resolve(ans); return true; }
            return false;
          };
          if (!check()) {
            const interval = setInterval(() => {
              if (check()) clearInterval(interval);
            }, 500);
          }
        });
      }

      const { is_correct }: PracticeCheckResponse = await practiceApi.check({
        question: current.question,
        correct_answer: correctAnswer,
        user_answer: answer,
        subject,
      });

      // Track first-attempt result
      const newFirstAttempt = [...practiceBatch.firstAttemptCorrect];
      if (newFirstAttempt[idx] === null) newFirstAttempt[idx] = is_correct;

      if (is_correct) {
        const result: PracticeResult = {
          problem: current.question,
          userAnswer: answer,
          correctAnswer: "",
          isCorrect: true,
        };
        const newFlags = [...practiceBatch.flags];
        newFlags[idx] = false;
        set({
          practiceBatch: {
            ...practiceBatch,
            results: [...practiceBatch.results, result],
            flags: newFlags,
            firstAttemptCorrect: newFirstAttempt,
            currentFeedback: "correct",
          },
          phase: "awaiting_input",
        });
      } else {
        const newFlags = [...practiceBatch.flags];
        newFlags[idx] = true;
        set({
          practiceBatch: {
            ...practiceBatch,
            flags: newFlags,
            firstAttemptCorrect: newFirstAttempt,
            currentFeedback: "wrong",
          },
          phase: "awaiting_input",
        });
      }
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  skipPracticeProblem() {
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
    if (next >= practiceBatch.problems.length) {
      set({
        practiceBatch: {
          ...practiceBatch,
          results: [...practiceBatch.results, result],
          flags: newFlags,
          firstAttemptCorrect: newFirstAttempt,
          currentFeedback: null,
        },
        phase: "practice_summary",
      });
    } else {
      set({
        practiceBatch: {
          ...practiceBatch,
          results: [...practiceBatch.results, result],
          flags: newFlags,
          firstAttemptCorrect: newFirstAttempt,
          currentFeedback: null,
          currentIndex: next,
        },
        phase: "awaiting_input",
      });
    }
  },

  submitPracticeWork(index, imageBase64, userAnswer) {
    const { practiceBatch, subject } = get();
    if (!practiceBatch) return;
    const problem = practiceBatch.problems[index];

    // Fire-and-forget — diagnosis happens in background
    workApi
      .submit({
        image_base64: imageBase64,
        problem_text: problem.question,
        user_answer: userAnswer,
        user_was_correct: false,
        subject,
      })
      .then((res) => {
        if (!res.diagnosis) return;
        const { practiceBatch: current } = get();
        if (!current) return;
        const newSubmissions = [...current.workSubmissions];
        newSubmissions[index] = res.diagnosis;
        // Auto-flag if diagnosis has issues
        const newFlags = [...current.flags];
        if (res.diagnosis.has_issues && !newFlags[index]) {
          newFlags[index] = true;
        }
        set({ practiceBatch: { ...current, workSubmissions: newSubmissions, flags: newFlags } });
      })
      .catch(() => {}); // Silent fail
  },

  nextPracticeProblem() {
    const { practiceBatch } = get();
    if (!practiceBatch) return;
    const next = practiceBatch.currentIndex + 1;
    if (next >= practiceBatch.problems.length) {
      set({ phase: "practice_summary" });
    } else {
      set({
        practiceBatch: { ...practiceBatch, currentIndex: next, currentFeedback: null },
        phase: "awaiting_input",
      });
    }
  },

  // ── Mock test ──

  async startMockTest(problems, generateCount, timeLimitMinutes) {
    const { subject, problemQueue } = get();
    const imageMap = new Map(problemQueue.map((p) => [p.text, p.image]));
    set({ phase: "loading", error: null });
    try {
      if (generateCount > 0) {
        // Generate similar — must wait for generation
        const image = imageMap.get(problems[0]);
        const { problems: generated } = await practiceApi.generate({
          problem: problems[0],
          count: generateCount,
          subject,
          ...(image && { image_base64: image }),
        });
        const { id } = await sessionApi.createMockTest(problems[0]);
        set({
          mockTest: {
            questions: generated,
            answers: {},
            flags: new Array(generated.length).fill(false),
            currentIndex: 0,
            timeLimitSeconds: timeLimitMinutes ? timeLimitMinutes * 60 : null,
            startedAt: Date.now(),
            submittedAt: null,
            results: null,
            sessionId: id,
            workImages: new Array(generated.length).fill(null),
            workSubmissions: new Array(generated.length).fill(null),
          },
          phase: "mock_test_active",
        });
      } else {
        // "Use as exam" — show questions immediately, solve answers in background
        const placeholders: PracticeProblem[] = problems.map((p) => ({
          question: p,
          answer: "",
        }));
        const { id } = await sessionApi.createMockTest(problems[0]);
        set({
          mockTest: {
            questions: placeholders,
            answers: {},
            flags: new Array(problems.length).fill(false),
            currentIndex: 0,
            timeLimitSeconds: timeLimitMinutes ? timeLimitMinutes * 60 : null,
            startedAt: Date.now(),
            submittedAt: null,
            results: null,
            sessionId: id,
            workImages: new Array(problems.length).fill(null),
            workSubmissions: new Array(problems.length).fill(null),
          },
          phase: "mock_test_active",
        });

        // Resolve correct answers in background
        Promise.allSettled(
          problems.map((p) => {
            const image = imageMap.get(p);
            return practiceApi.generate({
              problem: p, count: 0, subject,
              ...(image && { image_base64: image }),
            });
          }),
        ).then((results) => {
          const { mockTest: mt } = get();
          if (!mt) return;
          const updated = [...mt.questions];
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status === "fulfilled" && r.value.problems.length > 0) {
              updated[i] = r.value.problems[0];
            }
          }
          set({ mockTest: { ...mt, questions: updated } });
        });
      }
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  saveMockTestAnswer(index, answer) {
    set((state) => {
      if (!state.mockTest) return {};
      return {
        mockTest: {
          ...state.mockTest,
          answers: { ...state.mockTest.answers, [index]: answer },
        },
      };
    });
  },

  attachMockTestWork(index, imageBase64) {
    set((state) => {
      if (!state.mockTest) return {};
      const workImages = [...state.mockTest.workImages];
      workImages[index] = imageBase64;
      return { mockTest: { ...state.mockTest, workImages } };
    });
  },

  toggleMockTestFlag(index) {
    set((state) => {
      if (!state.mockTest) return {};
      const flags = [...state.mockTest.flags];
      flags[index] = !flags[index];
      return { mockTest: { ...state.mockTest, flags } };
    });
  },

  setMockTestIndex(index) {
    set((state) => {
      if (!state.mockTest) return {};
      return { mockTest: { ...state.mockTest, currentIndex: index } };
    });
  },

  async submitMockTest() {
    const { mockTest, subject } = get();
    if (!mockTest) return;
    set({ phase: "loading" });

    try {
      const results: MockTestResult[] = await Promise.all(
        mockTest.questions.map(async (q, i) => {
          const userAnswer = mockTest.answers[i] ?? null;
          if (!userAnswer) {
            return {
              question: q.question,
              userAnswer: null,
              correctAnswer: q.answer,
              isCorrect: null,
            };
          }
          const { is_correct } = await practiceApi.check({
            question: q.question,
            correct_answer: q.answer,
            user_answer: userAnswer,
            subject,
          });
          return {
            question: q.question,
            userAnswer,
            correctAnswer: q.answer,
            isCorrect: is_correct,
          };
        }),
      );

      // Record analytics
      if (mockTest.sessionId) {
        const correctCount = results.filter((r) => r.isCorrect === true).length;
        await sessionApi.completeMockTest(mockTest.sessionId, {
          total_questions: results.length,
          correct_count: correctCount,
        });
      }

      // Auto-flag incorrect and skipped questions (matches mobile)
      const newFlags = [...mockTest.flags];
      results.forEach((r, i) => {
        if (r.isCorrect !== true) newFlags[i] = true;
      });

      set({
        mockTest: {
          ...mockTest,
          results,
          flags: newFlags,
          submittedAt: Date.now(),
        },
        phase: "mock_test_summary",
      });

      // Fire work diagnosis in background for attached images (max 3 concurrent)
      const images = mockTest.workImages;
      const pending = images
        .map((img, i) => (img ? { img, i } : null))
        .filter(Boolean) as { img: string; i: number }[];

      const processBatch = async () => {
        for (let b = 0; b < pending.length; b += 3) {
          const batch = pending.slice(b, b + 3);
          await Promise.allSettled(
            batch.map(async ({ img, i }) => {
              const q = mockTest.questions[i];
              const r = results[i];
              const res = await workApi.submit({
                image_base64: img,
                problem_text: q.question,
                user_answer: r?.userAnswer ?? "",
                user_was_correct: r?.isCorrect === true,
                subject,
              });
              if (!res.diagnosis) return;
              const { mockTest: current } = get();
              if (!current) return;
              const newSubs = [...current.workSubmissions];
              newSubs[i] = res.diagnosis;
              const updatedFlags = [...current.flags];
              if (res.diagnosis.has_issues && !updatedFlags[i]) {
                updatedFlags[i] = true;
              }
              set({ mockTest: { ...current, workSubmissions: newSubs, flags: updatedFlags } });
            }),
          );
        }
      };
      processBatch().catch(() => {});
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  reset() {
    set(initialState);
  },
}));
