"use client";

import { useEffect, type ReactNode } from "react";
import { useAuthStore } from "@/stores/auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const loadUser = useAuthStore((s) => s.loadUser);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  return <>{children}</>;
}
