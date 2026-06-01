"use client";

import { create } from "zustand";
import {
  auth as authApi,
  clearTokens,
  isMfaChallenge,
  ApiError,
  type User,
} from "@/lib/api";

/** Login outcome surfaced to the caller. `mfa_required` means the
 *  user must complete an MFA challenge via `verifyMfa()` before being
 *  considered logged in. */
export type LoginOutcome = { mfa_required: false } | { mfa_required: true };

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;

  /** Pending MFA challenge — set after a login() call that returned an
   *  MFA-required response. Cleared by verifyMfa() success, cancelMfa(),
   *  or any other login(). */
  pendingMfa: { mfaPendingToken: string; email: string } | null;

  /** Try to restore session from stored tokens. */
  loadUser: () => Promise<void>;

  /** Submit password. If the account has MFA enabled, returns
   *  {mfa_required: true} and the caller must follow up with
   *  verifyMfa(code). Otherwise the user is fully logged in. */
  login: (email: string, password: string) => Promise<LoginOutcome>;

  /** Submit the 6-digit MFA code to complete login. Uses the pending
   *  challenge stashed by the prior login() call. */
  verifyMfa: (code: string) => Promise<void>;

  /** Discard the pending MFA challenge — e.g. user clicks "back" from
   *  the code entry screen. */
  cancelMfa: () => void;

  register: (data: {
    email: string;
    password: string;
    name: string;
    grade_level: number;
    role?: "student" | "teacher";
    invite_token?: string;
    section_invite_token?: string;
    join_code?: string;
    signup_school_name?: string;
  }) => Promise<void>;

  logout: () => void;

  deleteAccount: (password: string) => Promise<void>;

  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  error: null,
  pendingMfa: null,

  async loadUser() {
    // Cookie-first restore: HttpOnly cookies aren't visible to JS, so
    // we can't synchronously probe whether the user is logged in.
    // Always attempt /auth/me; the request carries the cookie via
    // credentials:"include". The legacy `hasStoredTokens()` gate
    // would falsely report "not logged in" for any cookie-only
    // session (e.g. localStorage cleared, signed in on another tab).
    try {
      const user = await authApi.me();
      set({ user, loading: false });
    } catch (err) {
      // Only clear local token state on definitive auth rejection
      // (401). Network errors and server errors leave any legacy
      // localStorage tokens intact so a transient failure doesn't
      // force a re-login.
      const isAuthError = err instanceof ApiError && err.status === 401;
      if (isAuthError) {
        clearTokens();
      }
      set({ user: null, loading: false });
    }
  },

  async login(email, password) {
    set({ loading: true, error: null, pendingMfa: null });
    try {
      const result = await authApi.login(email, password);
      if (isMfaChallenge(result)) {
        set({
          loading: false,
          pendingMfa: { mfaPendingToken: result.mfa_pending_token, email },
        });
        return { mfa_required: true };
      }
      // Cookie carries auth — the server already set HttpOnly cookies
      // on the response. Skipping saveTokens(): localStorage tokens
      // would be a dead-write (apiFetch no longer reads them) and an
      // unnecessary XSS surface. Mobile clients have their own store.
      const user = await authApi.me();
      set({ user, loading: false });
      return { mfa_required: false };
    } catch (err) {
      const message =
        (err as ApiError)?.message ?? "Login failed. Please try again.";
      set({ loading: false, error: message });
      throw err;
    }
  },

  async verifyMfa(code) {
    const pending = get().pendingMfa;
    if (!pending) {
      throw new Error("No pending MFA challenge");
    }
    set({ loading: true, error: null });
    try {
      // Cookies set on the response carry auth; don't save tokens
      // to localStorage. See login() for rationale.
      await authApi.loginVerifyMfa(pending.mfaPendingToken, code);
      const user = await authApi.me();
      set({ user, loading: false, pendingMfa: null });
    } catch (err) {
      const message =
        (err as ApiError)?.message ?? "Code verification failed.";
      // Some errors (expired, too many attempts, invalid challenge)
      // mean the pending token is no longer usable — clear it so the
      // UI drops back to the password step. "Incorrect code" leaves
      // the challenge intact so the user can try again.
      const fatal =
        err instanceof ApiError &&
        err.status === 401 &&
        !/incorrect code/i.test(err.message);
      set({
        loading: false,
        error: message,
        pendingMfa: fatal ? null : get().pendingMfa,
      });
      throw err;
    }
  },

  cancelMfa() {
    set({ pendingMfa: null, error: null });
  },

  async register(data) {
    set({ loading: true, error: null });
    try {
      // Cookies set on the response carry auth; don't save tokens
      // to localStorage. See login() for rationale.
      await authApi.register(data);
      const user = await authApi.me();
      set({ user, loading: false });
    } catch (err) {
      const message =
        (err as ApiError)?.message ?? "Registration failed. Please try again.";
      set({ loading: false, error: message });
      throw err;
    }
  },

  logout() {
    // Fire-and-forget the server logout so HttpOnly cookies get
    // cleared. A failure here is non-fatal — local token state is
    // cleared synchronously below, and the cookies expire eventually
    // anyway. Don't await; the user expects an instant sign-out.
    authApi.logout().catch(() => {});
    clearTokens();
    set({ user: null, loading: false, error: null, pendingMfa: null });
  },

  async deleteAccount(password: string) {
    await authApi.deleteAccount(password);
    clearTokens();
    set({ user: null, loading: false, error: null });
  },

  clearError() {
    set({ error: null });
  },
}));
