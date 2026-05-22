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
      // Width AND height-capped layout. The container caps width
      // (max-w-sm ≈ 384px) AND height (max-h-72 ≈ 288px) — without
      // BOTH caps, a tall-viewBox figure (height > width, e.g. an
      // isoceles triangle with one long altitude) renders at
      // max-width × aspect-ratio with no vertical ceiling, eating the
      // entire question card and overlapping the prose. The
      // [&_svg]:max-h-full + max-w-full forces the inner SVG to
      // respect both axes simultaneously; preserveAspectRatio="meet"
      // (set server-side) handles the proportional scaling.
      className={
        // The figure renders in a **fixed-height box** (h-72 = 288px)
        // and the inner SVG fills the height; width follows the
        // SVG's viewBox aspect via `preserveAspectRatio="xMidYMid meet"`
        // (set server-side). Width is capped at max-w-md (~448px) so
        // a very-wide figure doesn't overflow the question card.
        //
        // Critical: explicit h-72 (not max-h-72) makes the container
        // a fixed-height target. With max-h alone, the SVG was free
        // to render at its intrinsic 300x150 default scaled up to
        // container width, blowing through the max-h. With explicit
        // h-72 + svg height:100% + width:auto, the SVG is forced to
        // match the box exactly.
        //
        // `text-text-primary` sets color: var(--color-text); the
        // server SVG uses stroke="currentColor" so every line + label
        // adapts to light/dark theme.
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
