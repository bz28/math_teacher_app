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
  /** Images keyed by problem text, for passing to solver */
  imageMap: Record<string, string>;
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
  startPracticeQueue: (problems: string[]) => Promise<void>;
  submitPracticeAnswer: (answer: string) => Promise<void>;
  skipPracticeProblem: () => void;
  submitPracticeWork: (index: number, imageBase64: string, userAnswer: string) => void;
  nextPracticeProblem: () => void;
  togglePracticeFlag: (index: number) => void;
  retryFlaggedProblems: () => Promise<void>;


  // Reset
  reset: () => void;
}

function pollForState<T>(
  accessor: () => T | undefined | null,
  timeoutMs: number,
  intervalMs = 500,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    const check = () => {
      const value = accessor();
      if (value) {
        clearTimeout(timeout);
        resolve(value);
        return true;
      }
      return false;
    };
    if (!check()) {
      const interval = setInterval(() => {
        if (check()) clearInterval(interval);
      }, intervalMs);
    }
  });
}


function createPracticeBatch(
  problems: PracticeProblem[],
  sessionId: string | null,
  overrides?: Partial<PracticeBatch>,
): PracticeBatch {
  const len = problems.length;
  return {
    problems,
    currentIndex: 0,
    results: [],
    flags: new Array(len).fill(false),
    workSubmissions: new Array(len).fill(null),
    firstAttemptCorrect: new Array(len).fill(null),
    currentFeedback: null,
    sessionId,
    loadingMore: false,
    totalCount: 0,
    skippedProblems: [],
    ...overrides,
  };
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

    const imageRecord: Record<string, string> = {};
    for (const [k, v] of imageMap) {
      if (v) imageRecord[k] = v;
    }
    set({
      learnQueue: {
        problems,
        currentIndex: 0,
        flags: new Array(problems.length).fill(false),
        preloadedSessions: {},
        imageMap: imageRecord,
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
          .catch(console.error);
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

    const nextProblem = learnQueue.problems[nextIndex];
    const nextImage = learnQueue.imageMap[nextProblem];

    // Check if preloaded, or wait up to 15s for it
    let preloaded: SessionResponse | undefined | null = learnQueue.preloadedSessions[nextIndex];
    if (!preloaded) {
      set({
        learnQueue: { ...learnQueue, currentIndex: nextIndex },
        session: null,
        lastResponse: null,
        chatHistory: {},
        phase: "loading" as SessionPhase,
      });
      // Wait for preload to finish instead of creating a duplicate
      preloaded = await pollForState(
        () => get().learnQueue?.preloadedSessions[nextIndex],
        15_000,
      );
    }

    if (preloaded) {
      set({
        session: preloaded,
        sessionImage: nextImage ?? null,
        phase: "awaiting_input",
        lastResponse: null,
        chatHistory: {},
        learnQueue: { ...get().learnQueue!, currentIndex: nextIndex },
      });
      return;
    }

    // Fallback: preload timed out, generate fresh
    await get().startSession(nextProblem, nextImage);
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
        practiceBatch: createPracticeBatch(allProblems, sessionId),
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
        practiceBatch: createPracticeBatch(allProblems, sessionId),
        phase: "awaiting_input" as SessionPhase,
      });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async startPracticeBatch(problem, count) {
    const { subject } = get();
    set({ phase: "loading", error: null, sessionImage: null });
    try {
      const [{ problems }, { id: sessionId }] = await Promise.all([
        practiceApi.generate({ problem, count, subject }),
        sessionApi.createPracticeBatch(problem),
      ]);
      set({
        practiceBatch: createPracticeBatch(problems, sessionId),
        phase: "awaiting_input",
      });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async startPracticeQueue(problems) {
    if (problems.length === 0) return;
    const { subject } = get();

    // Show problems immediately with empty answers
    const placeholders: PracticeProblem[] = problems.map((p) => ({
      question: p,
      answer: "",
    }));
    const sessionId = await sessionApi.createPracticeBatch(problems[0])
      .then((r) => r.id)
      .catch(() => null);

    set({
      practiceBatch: createPracticeBatch(placeholders, sessionId, {
        loadingMore: true,
        totalCount: problems.length,
      }),
      phase: "awaiting_input",
    });

    // Resolve correct answers in background
    Promise.allSettled(
      problems.map((p) => practiceApi.generate({ problem: p, count: 0, subject })),
    ).then((results) => {
      const { practiceBatch: batch } = get();
      if (!batch) return;
      const updated = [...batch.problems];
      const skipped: string[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled" && r.value.problems[0]) {
          updated[i] = { question: problems[i], answer: r.value.problems[0].answer };
        } else {
          skipped.push(problems[i]);
        }
      }
      set({
        practiceBatch: {
          ...batch,
          problems: updated,
          loadingMore: false,
          skippedProblems: skipped,
        },
      });
    });
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
        const resolved = await pollForState(
          () => get().practiceBatch?.problems[idx]?.answer,
          30_000,
        );
        if (!resolved) throw new Error("Timed out waiting for answer");
        correctAnswer = resolved;
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
      .catch(console.error); // Silent fail
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


  reset() {
    set(initialState);
  },
}));
