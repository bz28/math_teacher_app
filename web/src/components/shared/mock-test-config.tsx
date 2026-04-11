"use client";

import { cn } from "@/lib/utils";

export type ExamType = "use_as_exam" | "generate_similar";

interface MockTestConfigProps {
  examType: ExamType;
  onExamTypeChange: (type: ExamType) => void;
  untimed: boolean;
  onUntimedChange: (untimed: boolean) => void;
  timeLimitMinutes: number;
  onTimeLimitChange: (minutes: number) => void;
  multipleChoice: boolean;
  onMultipleChoiceChange: (mc: boolean) => void;
}

interface PillOption<T extends string> {
  id: T;
  label: string;
}

function PillToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: PillOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="flex rounded-[--radius-pill] bg-input-bg p-[3px]"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              "rounded-[--radius-pill] px-3 py-1.5 text-xs font-semibold transition-colors",
              active ? "bg-primary text-white" : "text-text-secondary hover:text-text-primary",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Mock Test inline config card. Mirrors `mobile/src/components/MockTestConfig.tsx`
 * section-for-section: Questions / Time (w/ stepper) / Answers.
 */
export function MockTestConfig({
  examType,
  onExamTypeChange,
  untimed,
  onUntimedChange,
  timeLimitMinutes,
  onTimeLimitChange,
  multipleChoice,
  onMultipleChoiceChange,
}: MockTestConfigProps) {
  return (
    <div className="w-full rounded-[--radius-lg] border border-border-light bg-surface p-4 shadow-sm">
      {/* Questions */}
      <div className="flex min-h-9 items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary">Questions</span>
        <PillToggle
          ariaLabel="Question source"
          value={examType}
          onChange={onExamTypeChange}
          options={[
            { id: "use_as_exam", label: "Use mine" },
            { id: "generate_similar", label: "Generate" },
          ]}
        />
      </div>

      <div className="my-3 h-px bg-border-light" />

      {/* Time */}
      <div className="flex min-h-9 items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary">Time</span>
        <div className="flex items-center gap-2">
          <PillToggle
            ariaLabel="Time limit"
            value={untimed ? "untimed" : "timed"}
            onChange={(id) => onUntimedChange(id === "untimed")}
            options={[
              { id: "untimed", label: "Untimed" },
              { id: "timed", label: "Timed" },
            ]}
          />
          {!untimed && (
            <div className="flex items-center rounded-[--radius-pill] bg-input-bg">
              <button
                type="button"
                onClick={() => onTimeLimitChange(Math.max(1, timeLimitMinutes - 5))}
                disabled={timeLimitMinutes <= 1}
                aria-label="Decrease time by 5 minutes"
                className="flex h-7 w-7 items-center justify-center text-primary disabled:text-text-muted disabled:opacity-40"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              <span className="min-w-8 text-center text-xs font-semibold text-primary">
                {timeLimitMinutes}m
              </span>
              <button
                type="button"
                onClick={() => onTimeLimitChange(Math.min(180, timeLimitMinutes + 5))}
                disabled={timeLimitMinutes >= 180}
                aria-label="Increase time by 5 minutes"
                className="flex h-7 w-7 items-center justify-center text-primary disabled:text-text-muted disabled:opacity-40"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="my-3 h-px bg-border-light" />

      {/* Answers */}
      <div className="flex min-h-9 items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary">Answers</span>
        <PillToggle
          ariaLabel="Answer format"
          value={multipleChoice ? "mc" : "free"}
          onChange={(id) => onMultipleChoiceChange(id === "mc")}
          options={[
            { id: "mc", label: "Multiple choice" },
            { id: "free", label: "Free response" },
          ]}
        />
      </div>
    </div>
  );
}
