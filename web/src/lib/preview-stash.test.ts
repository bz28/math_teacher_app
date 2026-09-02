// Unit tests for when a stashed teacher session survives and when it ends.
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node src/lib/preview-stash.test.ts
//
// The regression this file exists for: clearing the stash inside
// saveTokens read like "a fresh sign-in ends any preview", but
// saveTokens also runs on every silent token refresh, and access tokens
// last 15 minutes. A preview open longer than that lost its stash — the
// banner vanished and "Back to teacher view" stopped working.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;
(globalThis as unknown as { window: unknown }).window = globalThis;

const {
  saveTokens,
  startSession,
  clearTokens,
  enterPreviewMode,
  exitPreviewMode,
  isInPreviewMode,
} = await import("./api.ts");

const TEACHER = {
  access_token: "T_access",
  refresh_token: "T_refresh",
  token_type: "bearer",
};
const STUDENT = {
  access_token: "S_access",
  refresh_token: "S_refresh",
  token_type: "bearer",
};
const access = () => localStorage.getItem("veradic_access_token");
const refresh = () => localStorage.getItem("veradic_refresh_token");

beforeEach(() => store.clear());

test("a token refresh mid-preview does not end the preview", () => {
  // Fails on the commit this file was added to fix.
  startSession(TEACHER);
  enterPreviewMode(STUDENT);

  saveTokens({
    access_token: "S_access_2",
    refresh_token: "S_refresh_2",
    token_type: "bearer",
  });

  assert.equal(isInPreviewMode(), true);
  assert.equal(exitPreviewMode(), true);
  assert.equal(access(), "T_access");
  assert.equal(refresh(), "T_refresh");
});

test("entering preview stashes the teacher and swaps in the student", () => {
  startSession(TEACHER);
  enterPreviewMode(STUDENT);
  assert.equal(isInPreviewMode(), true);
  assert.equal(access(), "S_access");
});

test("leaving preview restores the teacher and drops the stash", () => {
  startSession(TEACHER);
  enterPreviewMode(STUDENT);
  assert.equal(exitPreviewMode(), true);
  assert.equal(access(), "T_access");
  assert.equal(refresh(), "T_refresh");
  assert.equal(isInPreviewMode(), false);
});

test("signing out ends the preview", () => {
  startSession(TEACHER);
  enterPreviewMode(STUDENT);
  clearTokens();
  assert.equal(isInPreviewMode(), false);
});

test("a different person signing in ends the preview", () => {
  // The bug the previous fix was closing: without this, whoever signs
  // in next inherits a phantom banner whose exit hands them someone
  // else's tokens.
  startSession(TEACHER);
  enterPreviewMode(STUDENT);

  startSession({
    access_token: "OTHER_a",
    refresh_token: "OTHER_r",
    token_type: "bearer",
  });

  assert.equal(isInPreviewMode(), false);
  assert.equal(exitPreviewMode(), false);
  assert.equal(access(), "OTHER_a");
});

test("entering preview drops a stale stash rather than inheriting it", () => {
  // Reachable only after a prior leak, but the consequence is bad:
  // exitPreviewMode would install a stranger's tokens.
  localStorage.setItem("veradic_teacher_access_token", "STALE_a");
  localStorage.setItem("veradic_teacher_refresh_token", "STALE_r");

  enterPreviewMode(STUDENT);

  assert.equal(isInPreviewMode(), false);
  assert.equal(exitPreviewMode(), false);
  assert.equal(access(), "S_access");
});

test("exiting without a stash reports failure instead of clobbering", () => {
  startSession(TEACHER);
  assert.equal(exitPreviewMode(), false);
  assert.equal(access(), "T_access");
});
