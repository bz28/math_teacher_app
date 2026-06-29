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

  // `isUpgradeOpen` lets a host dialog suppress its own Escape-to-close
  // while this prompt is stacked on top, so Escape dismisses only the
  // prompt and never tears down the wizard underneath.
  return { showUpgrade: show, UpgradeModal: modal, isUpgradeOpen: state !== null };
}
