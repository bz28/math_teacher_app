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
        "geometry-figure mx-auto my-3 flex max-h-72 w-full max-w-sm " +
        "items-center justify-center " +
        "[&_svg]:block [&_svg]:max-h-full [&_svg]:max-w-full " +
        "[&_svg]:h-auto [&_svg]:w-auto " +
        (className ?? "")
      }
      // The SVG is pre-sanitized via DOMPurify above. Required for
      // inline rendering since SVG can't be loaded as a React node
      // tree directly without a parser.
      dangerouslySetInnerHTML={{ __html: cleaned }}
    />
  );
}
