"use client";

import { create } from "zustand";
import {
  session as sessionApi,
  EntitlementError,
  type SessionResponse,
  type StepResponse,
} from "@/lib/api";
import { pollForState } from "@/lib/poll";

// ── Types ──

export type SessionPhase =
  | "idle"
  | "loading"
  | "awaiting_input"
  | "thinking"
  | "completed"
  | "learn_summary"
  | "error";

export type Subject = "math" | "chemistry" | "physics";

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
  sectionId: string | null;

  // Step chat
  chatHistory: Record<number, ChatMessage[]>;

  // Learn queue
  learnQueue: LearnQueue | null;

  // Problem input
  problemQueue: { text: string; image?: string }[];

  // Actions
  setSubject: (subject: Subject) => void;
  setSectionId: (sectionId: string | null) => void;
  setProblemQueue: (queue: { text: string; image?: string }[]) => void;
  addToQueue: (problem: string, image?: string) => void;
  updateInQueue: (index: number, text: string) => void;
  removeFromQueue: (index: number) => void;

  // Learn actions
  startSession: (problem: string, image?: string) => Promise<void>;
  resumeSession: (sessionId: string) => Promise<void>;
  advanceStep: () => Promise<void>;
  askAboutStep: (question: string) => Promise<void>;

  // Learn completion actions
  continueAsking: () => void;
  finishAsking: () => void;

  // Learn queue actions
  startLearnQueue: (problems: string[]) => Promise<void>;
  advanceLearnQueue: () => Promise<void>;
  toggleLearnFlag: (index: number) => void;

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
  sectionId: null as string | null,
  chatHistory: {},
  learnQueue: null,
  problemQueue: [],
};

export const useSessionStore = create<SessionState>((set, get) => ({
  ...initialState,

  setSubject(subject) {
    set({ subject });
  },

  setSectionId(sectionId) {
    set({ sectionId });
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

  updateInQueue(index, text) {
    const { problemQueue } = get();
    set({
      problemQueue: problemQueue.map((p, i) => (i === index ? { ...p, text } : p)),
    });
  },

  removeFromQueue(index) {
    const { problemQueue } = get();
    set({ problemQueue: problemQueue.filter((_, i) => i !== index) });
  },

  // ── Learn session ──

  async startSession(problem, image) {
    const { subject, sectionId } = get();
    set({ phase: "loading", error: null });
    try {
      const session = await sessionApi.create({
        problem,
        mode: "learn",
        subject,
        ...(image && { image_base64: image }),
        ...(sectionId && { section_id: sectionId }),
      });
      set({ session, sessionImage: image ?? null, phase: "awaiting_input", chatHistory: {} });
    } catch (err) {
      if (err instanceof EntitlementError) throw err;
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

  async advanceStep() {
    const { session } = get();
    if (!session) return;
    set({ phase: "thinking" });
    try {
      const response = await sessionApi.respond(session.id, {
        student_response: "",
        request_advance: true,
      });
      // Re-fetch session to get updated steps/choices (matches mobile)
      const updated = await sessionApi.get(session.id);
      const nextPhase = response.action === "completed" ? "completed" : "awaiting_input";
      set({ session: updated, lastResponse: response, phase: nextPhase as SessionPhase });
    } catch (err) {
      if (err instanceof EntitlementError) throw err;
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async askAboutStep(question) {
    const { session } = get();
    if (!session) return;
    // On the completed phase the server reports current_step ===
    // total_steps (one past the last visible step). Step-chat is keyed
    // by the last visible step, so clamp to total_steps - 1 to keep
    // both the UI key and any out-of-range writes well-formed.
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
      if (err instanceof EntitlementError) throw err;
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
            // Functional setter so concurrent preload .then()s don't
            // overwrite each other's writes — reading learnQueue via
            // get() then calling set({...}) was racy: two preloads
            // finishing in the same tick would both see the same
            // pre-write snapshot, and the second one's spread would
            // drop the first's preloadedSessions entry.
            set((state) => {
              const lq = state.learnQueue;
              if (!lq) return state;
              return {
                learnQueue: {
                  ...lq,
                  preloadedSessions: {
                    ...lq.preloadedSessions,
                    [queueIndex]: s,
                  },
                },
              };
            });
          })
          .catch(() => {}); // Silently skip — preload failures are non-critical
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

  reset() {
    set(initialState);
  },
}));
