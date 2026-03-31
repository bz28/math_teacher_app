"use client";

import { useState, useCallback } from "react";
import { UpgradePrompt } from "@/components/shared/upgrade-prompt";

interface UpgradeState {
  entitlement: string;
  message: string;
}

export function useUpgradePrompt() {
  const [state, setState] = useState<UpgradeState | null>(null);

  const show = useCallback((entitlement: string, message: string) => {
    setState({ entitlement, message });
  }, []);

  const modal = (
    <UpgradePrompt
      open={state !== null}
      onClose={() => setState(null)}
      entitlement={state?.entitlement}
      message={state?.message}
    />
  );

  return { showUpgrade: show, UpgradeModal: modal };
}
