/**
 * Let a screen's mounted fetch (.then → setState) settle before asserting.
 *
 * RNTL's `waitFor`/`findBy*` rely on React's act() environment, which is
 * currently incompatible with this stack (jest-expo + RNTL 14 + React 19) — the
 * renderer reports "not configured to support act" even with the flag set, and
 * async updates don't flush inside `waitFor`. A single macrotask wait flushes
 * the microtask-driven state updates reliably; 200ms also absorbs the slower
 * cold-start first test without flaking.
 */
export const flush = () => new Promise((r) => setTimeout(r, 200));
