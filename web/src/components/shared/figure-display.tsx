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
}

export function FigureDisplay({ svg, className }: FigureDisplayProps) {
  const cleaned = useMemo(() => (svg ? sanitizeSvg(svg) : null), [svg]);

  if (!cleaned) return null;

  return (
    <div
      role="img"
      aria-label="Geometry figure"
      // Width-driven layout: cap container width, let height follow
      // the SVG's intrinsic aspect ratio. We force the inner <svg>
      // to `width:100%; height:auto; display:block` — without these
      // the browser falls back to the SVG's default 300x150 sizing
      // and figures with large coordinate-space side lengths render
      // way too big, overlapping the question text.
      className={
        "geometry-figure mx-auto my-3 w-full max-w-sm " +
        "[&_svg]:block [&_svg]:h-auto [&_svg]:w-full " +
        (className ?? "")
      }
      // The SVG is pre-sanitized via DOMPurify above. Required for
      // inline rendering since SVG can't be loaded as a React node
      // tree directly without a parser.
      dangerouslySetInnerHTML={{ __html: cleaned }}
    />
  );
}
