"use client";

import { useEffect, type ReactNode } from "react";
import { useAuthStore } from "@/stores/auth";
import { useEntitlementStore } from "@/stores/entitlements";

// Set by /pricing/success when its 30s poll times out without seeing
// is_pro=true. Picked up here so the next time the user mounts any
// authenticated page (including hard reload), we poll a few more
// times for the webhook to land — bridges the gap when Stripe is
// slow without blocking the user on the success page.
const PENDING_PRO_KEY = "veradic_pending_pro_activation";

export function AuthProvider({ children }: { children: ReactNode }) {
  const loadUser = useAuthStore((s) => s.loadUser);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);

  useEffect(() => {
    let cancelled = false;
    loadUser().then(() => {
      if (cancelled) return;
      const user = useAuthStore.getState().user;
      if (user) fetchEntitlements();

      // Catch-up refetch for a pending Stripe activation. Only fires
      // when the success page's primary poll timed out; clears once
      // is_pro flips or the user signs out.
      if (typeof window === "undefined") return;
      if (!sessionStorage.getItem(PENDING_PRO_KEY)) return;
      if (!user) {
        sessionStorage.removeItem(PENDING_PRO_KEY);
        return;
      }
      if (user.is_pro) {
        sessionStorage.removeItem(PENDING_PRO_KEY);
        return;
      }
      // Background follow-up: poll up to 5 more times at 4s
      // intervals (~20s) so a slow webhook still activates the
      // user without requiring them to refresh.
      let attempts = 0;
      const tick = async () => {
        if (cancelled) return;
        if (attempts >= 5) {
          sessionStorage.removeItem(PENDING_PRO_KEY);
          return;
        }
        attempts++;
        await loadUser();
        const u = useAuthStore.getState().user;
        if (u?.is_pro) {
          sessionStorage.removeItem(PENDING_PRO_KEY);
          await fetchEntitlements();
          return;
        }
        setTimeout(tick, 4000);
      };
      setTimeout(tick, 4000);
    });
    return () => {
      cancelled = true;
    };
  }, [loadUser, fetchEntitlements]);

  return <>{children}</>;
}
