"use client";

import { create } from "zustand";
import {
  auth as authApi,
  saveTokens,
  clearTokens,
  hasStoredTokens,
  ApiError,
  type User,
} from "@/lib/api";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;

  /** Try to restore session from stored tokens. */
  loadUser: () => Promise<void>;

  login: (email: string, password: string) => Promise<void>;

  register: (data: {
    email: string;
    password: string;
    name: string;
    grade_level: number;
    invite_token?: string;
    section_invite_token?: string;
    join_code?: string;
  }) => Promise<void>;

  logout: () => void;

  deleteAccount: (password: string) => Promise<void>;

  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,

  async loadUser() {
    if (!hasStoredTokens()) {
      set({ loading: false });
      return;
    }
    try {
      const user = await authApi.me();
      set({ user, loading: false });
    } catch (err) {
      // Only clear tokens on definitive auth rejection (401).
      // Network errors and server errors leave tokens intact so the
      // user isn't logged out by a transient failure.
      const isAuthError = err instanceof ApiError && err.status === 401;
      if (isAuthError) {
        clearTokens();
      }
      set({ user: null, loading: false });
    }
  },

  async login(email, password) {
    set({ loading: true, error: null });
    try {
      const tokens = await authApi.login(email, password);
      saveTokens(tokens);
      const user = await authApi.me();
      set({ user, loading: false });
    } catch (err) {
      const message =
        (err as ApiError)?.message ?? "Login failed. Please try again.";
      set({ loading: false, error: message });
      throw err;
    }
  },

  async register(data) {
    set({ loading: true, error: null });
    try {
      const tokens = await authApi.register(data);
      saveTokens(tokens);
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
    clearTokens();
    set({ user: null, loading: false, error: null });
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
