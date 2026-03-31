"use client";

import { useEffect, type ReactNode } from "react";
import { useAuthStore } from "@/stores/auth";
import { useEntitlementStore } from "@/stores/entitlements";

export function AuthProvider({ children }: { children: ReactNode }) {
  const loadUser = useAuthStore((s) => s.loadUser);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);

  useEffect(() => {
    loadUser().then(() => {
      // Fetch entitlements after user is loaded (needs auth token)
      const user = useAuthStore.getState().user;
      if (user) fetchEntitlements();
    });
  }, [loadUser, fetchEntitlements]);

  return <>{children}</>;
}
