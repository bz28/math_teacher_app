import { create } from "zustand";

/**
 * Trigger label passed to PaywallScreen so it can tailor its hero
 * copy to the context that opened it. Canonical labels currently in
 * use:
 *   - "create_session" / "image_scan" / "chat_message" / "work_diagnosis"
 *     (entitlement names — also accepted as raw EntitlementError values)
 *   - "post_signup"               — first-run paywall after register
 *   - "home_upgrade_card"         — banner on HomeScreen
 *   - "account_upgrade_card"      — banner on AccountScreen
 *
 * Anything not registered in TRIGGER_MESSAGES inside PaywallScreen.tsx
 * falls back to the generic "Unlock Pro" header. The type stays a
 * plain string so `EntitlementError.entitlement` (typed as string)
 * passes through without narrowing friction at call sites.
 */
export type PaywallTrigger = string | undefined;

interface PaywallState {
  visible: boolean;
  trigger: PaywallTrigger;
  show: (trigger?: PaywallTrigger) => void;
  hide: () => void;
}

/**
 * Global paywall modal state. PaywallScreen is rendered once at the
 * App.tsx root and driven by this store, so any screen can open the
 * paywall via `usePaywallStore.getState().show(trigger)` without
 * needing its own local visibility state and modal mount.
 */
export const usePaywallStore = create<PaywallState>((set) => ({
  visible: false,
  trigger: undefined,
  show: (trigger) => set({ visible: true, trigger }),
  hide: () => set({ visible: false, trigger: undefined }),
}));
