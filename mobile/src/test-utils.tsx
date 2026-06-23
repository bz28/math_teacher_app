import { screen } from "@testing-library/react-native";

/**
 * Poll for a text node, yielding to the event loop between checks.
 *
 * The act() environment is configured (jest.preenv.js sets
 * IS_REACT_ACT_ENVIRONMENT), but RNTL's `waitFor`/`findBy*` still don't observe
 * the microtask-driven state update from a mounted fetch in this stack
 * (jest-expo + RNTL 14 + React 19) — they fail fast without flushing it. Yield
 * (macrotask) → query, repeated, flushes those updates reliably and returns as
 * soon as the text appears, so it doesn't depend on a fixed sleep being long
 * enough for the slow cold-start first test on CI. Swap to `findBy*` if a
 * future RNTL/React version makes it observe these updates.
 */
export async function waitForText(text: string | RegExp, attempts = 40, gap = 50) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, gap));
    try {
      return screen.getByText(text);
    } catch {
      /* not yet — wait and retry */
    }
  }
  return screen.getByText(text); // final attempt throws RNTL's helpful error
}

/** Yield once so a pending state update (e.g. after fireEvent) settles. */
export const flush = () => new Promise((r) => setTimeout(r, 30));
