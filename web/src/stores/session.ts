"use client";

import { create } from "zustand";
import {
  session as sessionApi,
  practice as practiceApi,
  type SessionResponse,
  type StepResponse,
  type PracticeProblem,
  type PracticeCheckResponse,
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
  sessions: (SessionResponse | null)[];
}

export interface PracticeBatch {
  problems: PracticeProblem[];
  currentIndex: number;
  results: PracticeResult[];
  flags: boolean[];
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
  problemQueue: string[];

  // Actions
  setSubject: (subject: Subject) => void;
  setProblemQueue: (queue: string[]) => void;
  addToQueue: (problem: string) => void;
  removeFromQueue: (index: number) => void;

  // Learn actions
  startSession: (problem: string) => Promise<void>;
  resumeSession: (sessionId: string) => Promise<void>;
  submitAnswer: (answer: string) => Promise<void>;
  advanceStep: () => Promise<void>;
  askAboutStep: (question: string) => Promise<void>;

  // Learn completion actions
  continueAsking: () => void;
  finishAsking: () => void;
  tryPracticeProblem: () => Promise<void>;

  // Learn queue actions
  startLearnQueue: (problems: string[]) => Promise<void>;
  advanceLearnQueue: () => Promise<void>;
  toggleLearnFlag: (index: number) => void;
  practiceFlaggedFromLearnQueue: () => Promise<void>;

  // Practice actions
  startPracticeBatch: (problem: string, count: number) => Promise<void>;
  submitPracticeAnswer: (answer: string) => Promise<void>;
  nextPracticeProblem: () => void;
  togglePracticeFlag: (index: number) => void;
  retryFlaggedProblems: () => Promise<void>;

  // Mock test actions
  startMockTest: (problems: string[], generateCount: number, timeLimitMinutes: number | null) => Promise<void>;
  saveMockTestAnswer: (index: number, answer: string) => void;
  toggleMockTestFlag: (index: number) => void;
  setMockTestIndex: (index: number) => void;
  submitMockTest: () => Promise<void>;

  // Reset
  reset: () => void;
}

const initialState = {
  session: null,
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

  addToQueue(problem) {
    const { problemQueue } = get();
    if (problemQueue.length < 10) {
      set({ problemQueue: [...problemQueue, problem] });
    }
  },

  removeFromQueue(index) {
    const { problemQueue } = get();
    set({ problemQueue: problemQueue.filter((_, i) => i !== index) });
  },

  // ── Learn session ──

  async startSession(problem) {
    const { subject } = get();
    set({ phase: "loading", error: null });
    try {
      const session = await sessionApi.create({
        problem,
        mode: "learn",
        subject,
      });
      set({ session, phase: "awaiting_input", chatHistory: {} });
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
    set({
      learnQueue: {
        problems,
        currentIndex: 0,
        flags: new Array(problems.length).fill(false),
        sessions: new Array(problems.length).fill(null),
      },
    });
    // Start first session
    await get().startSession(problems[0]);
  },

  async advanceLearnQueue() {
    const { learnQueue } = get();
    if (!learnQueue) return;
    const nextIndex = learnQueue.currentIndex + 1;
    if (nextIndex >= learnQueue.problems.length) {
      set({ phase: "learn_summary" });
      return;
    }
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

  async tryPracticeProblem() {
    const { session, subject } = get();
    if (!session) return;
    set({ ...initialState, subject, phase: "loading" as SessionPhase });
    try {
      // Get a single similar problem (matches mobile: getSimilarProblem + createSession)
      const { similar_problem } = await sessionApi.similar(session.id);
      const newSession = await sessionApi.create({
        problem: similar_problem,
        mode: "practice",
        subject,
      });
      set({ session: newSession, phase: "awaiting_input" });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
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
      set({
        practiceBatch: {
          problems: allProblems,
          currentIndex: 0,
          results: [],
          flags: new Array(allProblems.length).fill(false),
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
      set({
        practiceBatch: {
          problems: allProblems,
          currentIndex: 0,
          results: [],
          flags: new Array(allProblems.length).fill(false),
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
      const { problems } = await practiceApi.generate({
        problem,
        count,
        subject,
      });
      set({
        practiceBatch: {
          problems,
          currentIndex: 0,
          results: [],
          flags: new Array(problems.length).fill(false),
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
    const current = practiceBatch.problems[practiceBatch.currentIndex];
    set({ phase: "thinking" });
    try {
      const { is_correct }: PracticeCheckResponse = await practiceApi.check({
        question: current.question,
        correct_answer: current.answer,
        user_answer: answer,
        subject,
      });
      const result: PracticeResult = {
        problem: current.question,
        userAnswer: answer,
        correctAnswer: current.answer,
        isCorrect: is_correct,
      };
      const newFlags = [...practiceBatch.flags];
      if (!is_correct) newFlags[practiceBatch.currentIndex] = true;

      set({
        practiceBatch: {
          ...practiceBatch,
          results: [...practiceBatch.results, result],
          flags: newFlags,
        },
        phase: "awaiting_input",
      });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  nextPracticeProblem() {
    const { practiceBatch } = get();
    if (!practiceBatch) return;
    const next = practiceBatch.currentIndex + 1;
    if (next >= practiceBatch.problems.length) {
      set({ phase: "practice_summary" });
    } else {
      set({
        practiceBatch: { ...practiceBatch, currentIndex: next },
        phase: "awaiting_input",
      });
    }
  },

  // ── Mock test ──

  async startMockTest(problems, generateCount, timeLimitMinutes) {
    const { subject } = get();
    set({ phase: "loading", error: null });
    try {
      let questions: PracticeProblem[];
      if (generateCount > 0) {
        const { problems: generated } = await practiceApi.generate({
          problem: problems[0],
          count: generateCount,
          subject,
        });
        questions = generated;
      } else {
        // Solve each problem individually to get answers (matches mobile)
        const results = await Promise.allSettled(
          problems.map((p) =>
            practiceApi.generate({ problem: p, count: 0, subject }),
          ),
        );
        questions = results.map((r, i) =>
          r.status === "fulfilled" && r.value.problems.length > 0
            ? r.value.problems[0]
            : { question: problems[i], answer: "" },
        );
      }

      // Create analytics session
      const { id } = await sessionApi.createMockTest(problems[0]);

      set({
        mockTest: {
          questions,
          answers: {},
          flags: new Array(questions.length).fill(false),
          currentIndex: 0,
          timeLimitSeconds: timeLimitMinutes ? timeLimitMinutes * 60 : null,
          startedAt: Date.now(),
          submittedAt: null,
          results: null,
          sessionId: id,
        },
        phase: "mock_test_active",
      });
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
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  reset() {
    set(initialState);
  },
}));
