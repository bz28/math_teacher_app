"use client";

import { create } from "zustand";
import { auth as authApi } from "@/lib/api";
import {
  FREE_DAILY_CHAT_LIMIT,
  FREE_DAILY_SCAN_LIMIT,
  FREE_DAILY_SESSION_LIMIT,
} from "@/lib/constants";

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
  incrementScansUsed: () => void;
}

export const useEntitlementStore = create<EntitlementState>((set) => ({
  isPro: false,
  dailySessionsUsed: 0,
  dailySessionsLimit: FREE_DAILY_SESSION_LIMIT,
  dailyScansUsed: 0,
  dailyScansLimit: FREE_DAILY_SCAN_LIMIT,
  dailyChatsUsed: 0,
  dailyChatsLimit: FREE_DAILY_CHAT_LIMIT,
  gatedFeatures: [],
  loaded: false,

  incrementScansUsed() {
    set((s) => ({ dailyScansUsed: s.dailyScansUsed + 1 }));
  },

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
}));
