"use client";

import { useMemo } from "react";

import { sanitizeSvg } from "@/lib/sanitize-svg";

// Inline SVG figure renderer for question-bank items that have a
// `figure_svg`. The server (api/core/geometry) produces the SVG at
// generation time and we trust its shape — but we still pipe it
// through DOMPurify since the SVG started life as LLM output, and
// defense-in-depth is cheap. DOMPurify's default SVG profile strips
// <script>, on* handlers, and external refs.
//
// Renders nothing when `svg` is null/empty — non-geometry items
// don't need a placeholder.

interface FigureDisplayProps {
  svg: string | null | undefined;
  /** Visual size budget — the SVG itself has a viewBox so it scales
   *  to fit. Default `max-h-56` keeps figures from dominating a
   *  question block; the student-practice surface overrides to a
   *  taller cap. */
  className?: string;
  /** Screen-reader label for the figure. Defaults to a generic
   *  "Geometry figure" but callers SHOULD pass problem-specific
   *  context (e.g. the question text or step description) so a
   *  screen-reader user navigating 5 distinct figures on a page
   *  doesn't hear "Geometry figure" 5 times. */
  ariaLabel?: string;
}

export function FigureDisplay({ svg, className, ariaLabel }: FigureDisplayProps) {
  const cleaned = useMemo(() => (svg ? sanitizeSvg(svg) : null), [svg]);

  if (!cleaned) return null;

  return (
    <div
      role="img"
      aria-label={ariaLabel ?? "Geometry figure"}
      className={
        // Fixed-height box (h-72 = 288px), width-capped at max-w-md
        // (~448px). The inner SVG fills the height and its width
        // follows the viewBox aspect via preserveAspectRatio="xMidYMid
        // meet" (set server-side), so a tall figure can't blow past the
        // box and a wide one can't overflow the question card.
        //
        // Critical: explicit h-72 (not max-h-72) makes the container a
        // fixed-height target. With max-h alone the SVG would render at
        // its intrinsic 300×150 scaled up to container width, blowing
        // through the cap. With h-72 + [&_svg]:h-full + w-auto the SVG
        // is forced to match the box exactly.
        //
        // text-text-primary sets color: var(--color-text); the server
        // SVG uses stroke="currentColor" so every line + label adapts
        // to light/dark theme.
        "geometry-figure mx-auto my-3 flex h-72 w-full max-w-md " +
        "items-center justify-center text-text-primary " +
        "[&_svg]:block [&_svg]:h-full [&_svg]:w-auto [&_svg]:max-w-full " +
        (className ?? "")
      }
      // The SVG is pre-sanitized via DOMPurify above. Required for
      // inline rendering since SVG can't be loaded as a React node
      // tree directly without a parser.
      dangerouslySetInnerHTML={{ __html: cleaned }}
    />
  );
}
