"use client";

import { Card } from "@/components/ui";
import { MathText } from "@/components/shared/math-text";

/**
 * Single-line banner rendered at the top of the Practice and Learn
 * surfaces. Tells the student which HW problem this loop is anchored
 * to so "Practice similar" and "Learn similar" don't feel unmoored.
 */
export function AnchorBanner({
  position,
  question,
}: {
  position: number;
  question: string;
}) {
  return (
    <Card variant="flat" className="border-primary/15 bg-primary-bg/40">
      <p className="text-xs font-semibold text-primary">
        Similar to Problem {position}
      </p>
      <div className="mt-1 line-clamp-1 text-sm text-text-secondary">
        <MathText text={question} />
      </div>
    </Card>
  );
}
