"use client";

import { create } from "zustand";
import { auth as authApi } from "@/lib/api";

interface EntitlementState {
  isPro: boolean;
  dailySessionsUsed: number;
  dailySessionsLimit: number;
  dailyScansUsed: number;
  dailyScansLimit: number;
  dailyChatsUsed: number;
  dailyChatsLimit: number;
  gatedFeatures: string[];
  loaded: boolean;

  fetchEntitlements: () => Promise<void>;
  sessionsRemaining: () => number;
  scansRemaining: () => number;
  chatsRemaining: () => number;
}

export const useEntitlementStore = create<EntitlementState>((set, get) => ({
  isPro: false,
  dailySessionsUsed: 0,
  dailySessionsLimit: 5,
  dailyScansUsed: 0,
  dailyScansLimit: 3,
  dailyChatsUsed: 0,
  dailyChatsLimit: 20,
  gatedFeatures: [],
  loaded: false,

  async fetchEntitlements() {
    try {
      const data = await authApi.entitlements();
      set({
        isPro: data.is_pro,
        dailySessionsUsed: data.limits.daily_sessions_used,
        dailySessionsLimit: data.limits.daily_sessions_limit ?? Infinity,
        dailyScansUsed: data.limits.daily_scans_used,
        dailyScansLimit: data.limits.daily_scans_limit ?? Infinity,
        dailyChatsUsed: data.limits.daily_chats_used,
        dailyChatsLimit: data.limits.daily_chats_limit ?? Infinity,
        gatedFeatures: data.gated_features,
        loaded: true,
      });
    } catch {
      // Fail silently — use defaults
    }
  },

  sessionsRemaining() {
    const { isPro, dailySessionsUsed, dailySessionsLimit } = get();
    if (isPro) return Infinity;
    return Math.max(0, dailySessionsLimit - dailySessionsUsed);
  },

  scansRemaining() {
    const { isPro, dailyScansUsed, dailyScansLimit } = get();
    if (isPro) return Infinity;
    return Math.max(0, dailyScansLimit - dailyScansUsed);
  },

  chatsRemaining() {
    const { isPro, dailyChatsUsed, dailyChatsLimit } = get();
    if (isPro) return Infinity;
    return Math.max(0, dailyChatsLimit - dailyChatsUsed);
  },
}));
