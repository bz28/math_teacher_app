import { useState, useCallback } from "react";

interface PromptState {
  title: string;
  message: string;
  trigger: string;
}

export function useUpgradePrompt() {
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallTrigger, setPaywallTrigger] = useState<string | undefined>();

  const show = useCallback((trigger: string, title: string, message: string) => {
    setPrompt({ trigger, title, message });
  }, []);

  const closePrompt = useCallback(() => setPrompt(null), []);

  const handleUpgrade = useCallback(() => {
    const trigger = prompt?.trigger;
    setPrompt(null);
    setPaywallTrigger(trigger);
    setPaywallVisible(true);
  }, [prompt]);

  const closePaywall = useCallback(() => setPaywallVisible(false), []);

  return {
    show,
    promptProps: {
      visible: prompt !== null,
      title: prompt?.title ?? "",
      message: prompt?.message ?? "",
      onClose: closePrompt,
      onUpgrade: handleUpgrade,
    },
    paywallVisible,
    paywallTrigger,
    closePaywall,
  };
}
