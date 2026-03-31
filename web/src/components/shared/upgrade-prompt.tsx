"use client";

import Link from "next/link";
import { Modal } from "@/components/ui/modal";

const FEATURE_LABELS: Record<string, { title: string; description: string }> = {
  create_session: {
    title: "Daily Problem Limit Reached",
    description: "Free accounts are limited to 5 problems per day across all modes. Upgrade to Pro for unlimited access.",
  },
  work_diagnosis: {
    title: "Work Diagnosis is Pro Only",
    description: "Upload your handwritten work and get AI-powered step-by-step grading.",
  },
};

const DEFAULT_FEATURE = {
  title: "Pro Feature Required",
  description: "This feature requires a Pro subscription. Upgrade to unlock all features.",
};

interface UpgradePromptProps {
  open: boolean;
  onClose: () => void;
  entitlement?: string;
  message?: string;
}

export function UpgradePrompt({ open, onClose, entitlement, message }: UpgradePromptProps) {
  const feature = entitlement ? FEATURE_LABELS[entitlement] ?? DEFAULT_FEATURE : DEFAULT_FEATURE;

  return (
    <Modal open={open} onClose={onClose}>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-bg">
          <svg className="h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-text-primary">{feature.title}</h2>
        <p className="mt-2 text-sm text-text-secondary">
          {message || feature.description}
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-[--radius-pill] border border-border-light py-2.5 text-sm font-bold text-text-secondary transition-colors hover:bg-primary-bg"
          >
            Maybe Later
          </button>
          <Link
            href="/pricing"
            onClick={onClose}
            className="flex-1 rounded-[--radius-pill] bg-primary py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-primary-dark"
          >
            Upgrade to Pro
          </Link>
        </div>
      </div>
    </Modal>
  );
}
