"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { teacher, type TeacherPreferences } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

/**
 * Teacher-level preferences. Today: auto-gen practice on publish +
 * default practice count. Extensible — more fields can land here
 * without changing the page shell.
 *
 * Changes save inline (no save button) so the teacher never has to
 * remember to commit the change. Each field has its own save state
 * so a saving count input doesn't block the toggle.
 */
export default function TeacherPreferencesPage() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<TeacherPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState<
    null | "auto" | "count"
  >(null);

  useEffect(() => {
    teacher
      .preferences()
      .then((p) => setPrefs(p))
      .catch(() => toast.error("Couldn't load preferences"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = async (
    field: "auto" | "count",
    patch: Partial<TeacherPreferences>,
    label: string,
  ) => {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, ...patch });
    setSavingField(field);
    try {
      const next = await teacher.updatePreferences(patch);
      setPrefs(next);
      toast.success(`${label} saved`);
    } catch {
      setPrefs(previous);
      toast.error("Couldn't save — try again");
    } finally {
      setSavingField(null);
    }
  };

  if (loading || !prefs) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-sm text-text-muted">
        Loading…
      </div>
    );
  }

  const countChips: number[] = [1, 3, 5, 10];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-5">
        <Link
          href="/school/teacher"
          className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-primary"
        >
          ← Back to courses
        </Link>
      </div>

      <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
        Preferences
      </h1>
      <p className="mt-1 text-sm text-text-secondary">
        Defaults for new homeworks. You can still override per homework
        on its Practice page.
      </p>

      <section className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">
          Practice problems
        </h2>
        <p className="mt-1 text-xs text-text-secondary">
          When you publish a homework, we can automatically generate a
          pool of similar problems for students to practice. You review
          them on the Practice page.
        </p>

        {/* Auto-gen toggle */}
        <div className="mt-5 flex items-start justify-between gap-4 rounded-[--radius-md] border border-border-light bg-bg-base/40 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-text-primary">
              Auto-generate practice on publish
            </div>
            <div className="mt-0.5 text-xs text-text-secondary">
              Turn this off if you&apos;d rather generate manually from
              the Practice page.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.auto_generate_practice_on_publish}
            onClick={() =>
              patch(
                "auto",
                {
                  auto_generate_practice_on_publish:
                    !prefs.auto_generate_practice_on_publish,
                },
                "Auto-generate",
              )
            }
            disabled={savingField === "auto"}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              prefs.auto_generate_practice_on_publish
                ? "bg-primary"
                : "bg-bg-subtle"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                prefs.auto_generate_practice_on_publish
                  ? "translate-x-6"
                  : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Default count chips */}
        <div className="mt-3 rounded-[--radius-md] border border-border-light bg-bg-base/40 px-4 py-3">
          <div className="text-sm font-bold text-text-primary">
            Default practice count
          </div>
          <div className="mt-0.5 text-xs text-text-secondary">
            How many practice problems to generate per homework question.
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {countChips.map((n) => {
              const active = prefs.default_practice_count === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() =>
                    patch(
                      "count",
                      { default_practice_count: n },
                      "Default count",
                    )
                  }
                  disabled={savingField === "count"}
                  className={`rounded-[--radius-pill] border px-3 py-1 text-xs font-bold transition-colors disabled:opacity-50 ${
                    active
                      ? "border-primary bg-primary text-white"
                      : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:bg-bg-subtle"
                  }`}
                >
                  {n}
                </button>
              );
            })}
            <input
              type="number"
              min={1}
              max={20}
              value={prefs.default_practice_count}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(n) && n >= 1 && n <= 20) {
                  patch(
                    "count",
                    { default_practice_count: n },
                    "Default count",
                  );
                }
              }}
              aria-label="Custom practice count"
              className="w-14 rounded-[--radius-pill] border border-border-light bg-bg-base px-2 py-1 text-center text-xs font-bold text-text-primary focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
