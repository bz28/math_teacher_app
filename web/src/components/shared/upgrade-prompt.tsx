"use client";

import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { FREE_DAILY_SESSION_LIMIT, FREE_DAILY_SCAN_LIMIT, FREE_DAILY_CHAT_LIMIT } from "@/lib/constants";

const FEATURE_LABELS: Record<string, { title: string; description: string }> = {
  create_session: {
    title: "Daily Problem Limit Reached",
    description: `Free accounts are limited to ${FREE_DAILY_SESSION_LIMIT} problems per day across all modes. Upgrade to Pro for unlimited access.`,
  },
  work_diagnosis: {
    title: "Work Diagnosis is Pro Only",
    description: "Upload your handwritten work and get AI-powered step-by-step grading.",
  },
  image_scan: {
    title: "Daily Scan Limit Reached",
    description: `Free accounts are limited to ${FREE_DAILY_SCAN_LIMIT} image scans per day. Upgrade to Pro for unlimited scans.`,
  },
  chat_message: {
    title: "Daily Chat Limit Reached",
    description: `Free accounts are limited to ${FREE_DAILY_CHAT_LIMIT} chat messages per day. Upgrade to Pro for unlimited chat.`,
  },
  generate_problem: {
    title: "You've hit today's free limit",
    description:
      "Independent teacher accounts can generate 10 AI problems per day. Upgrade to Teacher Pro for unlimited generation.",
  },
};

// Entitlements that belong to the teacher tier — the upgrade CTA
// routes to /pricing?view=teacher so the teacher card is selected
// on arrival. Everything else (student-facing entitlements) stays on
// the default /pricing entry.
const TEACHER_ENTITLEMENTS = new Set(["generate_problem"]);

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
  const isTeacherTier = entitlement ? TEACHER_ENTITLEMENTS.has(entitlement) : false;
  const ctaHref = isTeacherTier ? "/pricing?view=teacher" : "/pricing";
  const ctaLabel = isTeacherTier ? "Upgrade — $19/mo" : "Upgrade to Pro";

  return (
    // outerClassName: z-[80] so the upgrade prompt paints above a host
    // modal (some of which sit at z-50, some at z-[60]). Without this
    // override the prompt would be hidden behind the modal that
    // triggered it.
    <Modal open={open} onClose={onClose} outerClassName="z-[80]">
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
            href={ctaHref}
            onClick={onClose}
            className="flex-1 rounded-[--radius-pill] bg-primary py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-primary-dark"
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </Modal>
  );
}
