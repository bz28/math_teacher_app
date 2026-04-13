import type {
  PracticeProblem,
  SessionData,
  StepResponse,
  WorkDiagnosis,
} from "../services/api";

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

export interface PracticeResult {
  problem: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
}

export interface PracticeBatch {
  problems: PracticeProblem[];
  currentIndex: number;
  results: PracticeResult[];
  flags: boolean[];
  /** True while remaining problems are being generated in the background */
  loadingMore: boolean;
  /** Total number of problems requested (original + similar) */
  totalCount: number;
  /** Problems that failed to process and were skipped */
  skippedProblems: string[];
  /** Number of answer checks still in flight */
  pendingChecks: number;
  /** Diagnosis results from submitted work photos, parallel to problems array */
  workSubmissions: (WorkDiagnosis | null)[];
  /** Tracks first-attempt correctness per problem: null = not attempted, true/false = first attempt result */
  firstAttemptCorrect: (boolean | null)[];
  /** Inline feedback for the current problem after an answer check */
  currentFeedback: 'correct' | 'wrong' | null;
  /** Backend session ID for history tracking */
  sessionId: string | null;
}

export interface LearnQueue {
  problems: string[];
  currentIndex: number;
  flags: boolean[];
  /** Pre-generated sessions for upcoming problems, keyed by queue index */
  preloadedSessions: Record<number, SessionData>;
}

export interface MockTestResult {
  question: string;
  userAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean | null;
}

export interface MockTest {
  sessionId: string | null;
  questions: PracticeProblem[];
  answers: Record<number, string>;
  flags: boolean[];
  currentIndex: number;
  timeLimitSeconds: number | null;
  startedAt: number;
  submittedAt: number | null;
  results: MockTestResult[] | null;
  /** Base64 photos held locally until test submit */
  workImages: (string | null)[];
  /** Diagnosis results from submitted work photos, parallel to questions array */
  workSubmissions: (WorkDiagnosis | null)[];
  /** Whether the test uses multiple choice or free response */
  multipleChoice: boolean;
}

export interface ChatMessage {
  role: "user" | "tutor";
  text: string;
}

export interface SessionState {
  // Learn mode state
  session: SessionData | null;
  phase: SessionPhase;
  lastResponse: StepResponse | null;
  error: string | null;
  /** Persistent follow-up Q&A history per step index */
  chatHistory: Record<number, ChatMessage[]>;

  // Subject (math, chemistry, etc.)
  subject: string;

  // Practice batch state
  practiceBatch: PracticeBatch | null;

  // Learn queue state
  learnQueue: LearnQueue | null;

  // Mock test state
  mockTest: MockTest | null;

  // Problem input state (shared between App and InputScreen)
  problemQueue: string[];
  problemImages: Record<string, string>;
  practiceCount: number;

  // Actions
  setSubject: (subject: string) => void;
  setProblemQueue: (queue: string[]) => void;
  setPracticeCount: (count: number) => void;
  startSession: (problem: string, mode?: string) => Promise<void>;
  resumeSession: (sessionId: string) => Promise<void>;
  startPracticeBatch: (problem: string, similarCount: number) => Promise<void>;
  startPracticeQueue: (problems: string[]) => Promise<void>;
  startLearnQueue: (problems: string[]) => Promise<void>;
  submitPracticeAnswer: (answer: string) => Promise<void>;
  skipPracticeProblem: () => void;
  advanceStep: () => Promise<void>;
  askAboutStep: (question: string) => Promise<void>;
  togglePracticeFlag: (index: number) => void;
  toggleLearnFlag: (index: number) => void;
  advanceLearnQueue: () => Promise<void>;
  practiceFlaggedFromLearnQueue: () => Promise<void>;
  switchToLearnMode: () => Promise<void>;
  continueAsking: () => void;
  finishAsking: () => void;

  startMockTest: (problems: string[], generateCount: number, timeLimitMinutes: number | null, multipleChoice?: boolean) => Promise<void>;
  saveMockTestAnswer: (index: number, answer: string) => void;
  navigateMockQuestion: (index: number) => void;
  toggleMockTestFlag: (index: number) => void;
  submitMockTest: () => Promise<void>;
  attachWorkImage: (index: number, imageBase64: string) => void;
  submitPracticeWork: (index: number, imageBase64: string, userAnswer: string) => void;
  reset: () => void;
}

export const initialState = {
  session: null as SessionData | null,
  phase: "idle" as SessionPhase,
  lastResponse: null as StepResponse | null,
  error: null as string | null,
  chatHistory: {} as Record<number, ChatMessage[]>,
  subject: "math",
  practiceBatch: null as PracticeBatch | null,
  learnQueue: null as LearnQueue | null,
  mockTest: null as MockTest | null,
  problemQueue: [] as string[],
  problemImages: {} as Record<string, string>,
  practiceCount: 3,
};

export type StoreSet = (partial: Partial<SessionState>) => void;
export type StoreGet = () => SessionState;
export type StoreSubscribe = (listener: (state: SessionState) => void) => () => void;
