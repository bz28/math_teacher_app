import { create } from "zustand";
import { parseProblem, type ParsedProblem } from "../services/api";

interface ProblemState {
  input: string;
  parsed: ParsedProblem | null;
  loading: boolean;
  error: string | null;

  setInput: (text: string) => void;
  submit: () => Promise<void>;
  clear: () => void;
}

export const useProblemStore = create<ProblemState>((set, get) => ({
  input: "",
  parsed: null,
  loading: false,
  error: null,

  setInput: (text) => set({ input: text, error: null }),

  submit: async () => {
    const { input } = get();
    if (!input.trim()) return;

    set({ loading: true, error: null, parsed: null });
    try {
      const result = await parseProblem(input.trim());
      set({ parsed: result, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  clear: () => set({ input: "", parsed: null, loading: false, error: null }),
}));
