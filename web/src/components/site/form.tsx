"use client";

import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from "react";

/**
 * Form parts for the signed-out pages (sign in, register) in the notebook
 * design. The app's own Input and Button stay as they are, so the
 * logged-in app doesn't change.
 *
 * Ids follow the app's Input (the label, lowercased, spaces to dashes), so
 * "Email" is #email and "Password" is #password: the login flow test and
 * password managers find the same fields as before.
 */

// 3:1 against white for the border (WCAG non-text contrast); the
// placeholder is 4.5:1 on the field.
const FIELD =
  "block w-full rounded-[6px] border-[1.5px] bg-[#FBFAF6] px-3.5 py-3 text-ink placeholder:font-normal placeholder:text-[#646D79] transition-colors focus:border-veradic disabled:cursor-not-allowed disabled:opacity-60";

/** Size and border, chosen here rather than overridden, since two text
 *  sizes on one element would race in the stylesheet. */
function fieldLook(error?: string, large?: boolean) {
  const size = large
    ? "text-2xl font-extrabold uppercase tracking-[0.3em] placeholder:tracking-[0.3em]"
    : "text-base font-medium";
  const border = error ? "border-redpen focus:border-redpen" : large ? "border-veradic" : "border-[#8A93A0]";
  return `${FIELD} ${size} ${border}`;
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** A message under the field that something is wrong (in red). */
  error?: string;
  /** A plain help line under the field. */
  hint?: ReactNode;
  /** Set the input large and letter-spaced, for a code someone copies
   *  from the board (the class join code, the sign-in code). */
  large?: boolean;
};

function idFor(label: string, id?: string) {
  return id ?? label.toLowerCase().replace(/\s+/g, "-");
}

function Notes({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  return (
    <>
      {error && (
        <p id={`${id}-error`} className="m-0 mt-1.5 text-sm font-semibold text-redpen">
          {error}
        </p>
      )}
      {hint && (
        <p id={`${id}-hint`} className="m-0 mt-1.5 text-sm leading-[1.5] text-ink-soft">
          {hint}
        </p>
      )}
    </>
  );
}

function describedBy(id: string, error?: string, hint?: ReactNode) {
  const ids = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export const SiteInput = forwardRef<HTMLInputElement, FieldProps>(
  ({ label, error, hint, large, id, className = "", ...props }, ref) => {
    const inputId = idFor(label, id);
    return (
      <div className={className}>
        <label htmlFor={inputId} className="block text-[15px] font-bold text-ink">
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(inputId, error, hint)}
          className={`mt-2 ${fieldLook(error, large)}`}
          {...props}
        />
        <Notes id={inputId} error={error} hint={hint} />
      </div>
    );
  },
);
SiteInput.displayName = "SiteInput";

export const SitePasswordInput = forwardRef<HTMLInputElement, Omit<FieldProps, "type">>(
  ({ label, error, hint, large, id, className = "", ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const inputId = idFor(label, id);
    return (
      <div className={className}>
        <label htmlFor={inputId} className="block text-[15px] font-bold text-ink">
          {label}
        </label>
        <div className="relative mt-2">
          <input
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(inputId, error, hint)}
            className={`${fieldLook(error, large)} pr-12`}
            {...props}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            className="absolute inset-y-0 right-1.5 my-auto flex h-9 w-9 items-center justify-center rounded-[4px] text-ink-soft transition-colors hover:text-ink"
          >
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {visible && <path d="M4 4l16 16" />}
            </svg>
          </button>
        </div>
        <Notes id={inputId} error={error} hint={hint} />
      </div>
    );
  },
);
SitePasswordInput.displayName = "SitePasswordInput";

/** The form's one green action, full width. Disabled while it works. */
export function SiteSubmit({
  loading = false,
  disabled = false,
  children,
}: {
  loading?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className="flex w-full items-center justify-center gap-2.5 rounded-[6px] bg-veradic px-4 py-4 text-[17px] font-extrabold text-white transition-colors hover:bg-veradic-dark disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading && <Spinner className="h-4 w-4 border-white" />}
      {children}
    </button>
  );
}

/** A small spinning ring; `className` sets its size and colour. */
export function Spinner({ className = "h-6 w-6 border-veradic" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-2 border-t-transparent motion-reduce:animate-none ${className}`}
    />
  );
}
