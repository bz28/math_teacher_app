"use client";

import {
  forwardRef,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

// ── Text Input ──

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-[13px] font-semibold tracking-wide text-text-secondary"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "h-11 rounded-[--radius-md] border border-border bg-input-bg px-4 text-base text-text-primary",
            "placeholder:text-text-muted",
            "transition-colors focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20",
            error && "border-error focus:border-error focus:ring-error/20",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
          {...props}
        />
        {error && (
          <p className="text-xs font-medium text-error">{error}</p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

// ── Textarea ──

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-[13px] font-semibold tracking-wide text-text-secondary"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            "min-h-[100px] rounded-[--radius-md] border border-border bg-input-bg px-4 py-3 text-base text-text-primary resize-y",
            "placeholder:text-text-muted",
            "transition-colors focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20",
            error && "border-error focus:border-error focus:ring-error/20",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
          {...props}
        />
        {error && (
          <p className="text-xs font-medium text-error">{error}</p>
        )}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";

// ── Password Input ──

type PasswordInputProps = Omit<InputProps, "type">;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-12", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
          tabIndex={-1}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? (
            <EyeOffIcon className="h-5 w-5" />
          ) : (
            <EyeIcon className="h-5 w-5" />
          )}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
