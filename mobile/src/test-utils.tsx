/**
 * Let a screen's mounted fetch (.then → setState) settle before asserting.
 *
 * The act() environment is configured (jest.preenv.js sets
 * IS_REACT_ACT_ENVIRONMENT), but RNTL's `waitFor`/`findBy*` still don't observe
 * the microtask-driven state update from a mounted fetch in this stack
 * (jest-expo + RNTL 14 + React 19) — they fail fast without flushing it. A
 * single macrotask wait flushes those updates reliably; 200ms also absorbs the
 * slower cold-start first test without flaking. Swap to `findBy*` if a future
 * RNTL/React version makes it observe these updates.
 */
export const flush = () => new Promise((r) => setTimeout(r, 200));
