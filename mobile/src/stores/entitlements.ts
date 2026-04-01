import { create } from "zustand";
import { getEntitlements, type EntitlementsData } from "../services/api";

interface EntitlementState {
  isPro: boolean;
  tier: string;
  status: string;
  expiresAt: string | null;
  dailySessionsUsed: number;
  dailySessionsLimit: number;
  dailyScansUsed: number;
  dailyScansLimit: number;
  dailyChatsUsed: number;
  dailyChatsLimit: number;
  gatedFeatures: string[];
  loaded: boolean;

  fetchEntitlements: () => Promise<void>;
  canUseFeature: (feature: string) => boolean;
  canCreateSession: () => boolean;
  sessionsRemaining: () => number;
  scansRemaining: () => number;
  chatsRemaining: () => number;
}

export const useEntitlementStore = create<EntitlementState>((set, get) => ({
  isPro: false,
  tier: "free",
  status: "none",
  expiresAt: null,
  dailySessionsUsed: 0,
  dailySessionsLimit: 5,
  dailyScansUsed: 0,
  dailyScansLimit: 3,
  dailyChatsUsed: 0,
  dailyChatsLimit: 20,
  gatedFeatures: [],
  loaded: false,

  fetchEntitlements: async () => {
    const data: EntitlementsData = await getEntitlements();
    set({
      isPro: data.is_pro,
      tier: data.subscription_tier,
      status: data.subscription_status,
      expiresAt: data.subscription_expires_at,
      dailySessionsUsed: data.limits.daily_sessions_used,
      dailySessionsLimit: data.limits.daily_sessions_limit ?? Infinity,
      dailyScansUsed: data.limits.daily_scans_used,
      dailyScansLimit: data.limits.daily_scans_limit ?? Infinity,
      dailyChatsUsed: data.limits.daily_chats_used,
      dailyChatsLimit: data.limits.daily_chats_limit ?? Infinity,
      gatedFeatures: data.gated_features,
      loaded: true,
    });
  },

  canUseFeature: (feature: string) => {
    const { gatedFeatures, isPro } = get();
    return isPro || !gatedFeatures.includes(feature);
  },

  canCreateSession: () => {
    const { isPro, dailySessionsUsed, dailySessionsLimit } = get();
    return isPro || dailySessionsUsed < dailySessionsLimit;
  },

  sessionsRemaining: () => {
    const { isPro, dailySessionsUsed, dailySessionsLimit } = get();
    if (isPro) return Infinity;
    return Math.max(0, dailySessionsLimit - dailySessionsUsed);
  },

  scansRemaining: () => {
    const { isPro, dailyScansUsed, dailyScansLimit } = get();
    if (isPro) return Infinity;
    return Math.max(0, dailyScansLimit - dailyScansUsed);
  },

  chatsRemaining: () => {
    const { isPro, dailyChatsUsed, dailyChatsLimit } = get();
    if (isPro) return Infinity;
    return Math.max(0, dailyChatsLimit - dailyChatsUsed);
  },
}));
