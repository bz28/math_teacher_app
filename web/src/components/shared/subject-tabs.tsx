"use client";

import { cn } from "@/lib/utils";

interface SubjectTabsProps {
  /** The tab definitions, in render order. `label` may be a string or node. */
  tabs: { key: string; label: React.ReactNode }[];
  /** The currently active tab key. */
  active: string;
  /** Called with the tab key when a tab is clicked. */
  onSelect: (key: string) => void;
  className?: string;
}

/**
 * Editorial underline tabs — quiet, tracked, hairline-ruled. One active
 * mark (a primary underline) instead of a filled pill, so the tabs read as
 * a section index rather than a control panel. Shared across the
 * personal-learner pages (Review, History) so they speak the same language.
 */
export function SubjectTabs({ tabs, active, onSelect, className }: SubjectTabsProps) {
  return (
    <div role="tablist" className={cn("flex gap-7 border-b border-border", className)}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.key)}
            className={cn(
              "relative -mb-px pb-3 text-sm font-medium transition-colors",
              isActive
                ? "text-text-primary"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {tab.label}
            {isActive && (
              <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}
