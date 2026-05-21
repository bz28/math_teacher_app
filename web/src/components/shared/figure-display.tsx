"use client";

import DOMPurify from "dompurify";
import { useMemo } from "react";

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
  const cleaned = useMemo(() => {
    if (!svg) return null;
    // USE_PROFILES.svg is the right profile for inline SVG —
    // permits geometry/text elements, blocks scripting + foreign
    // content.
    return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } });
  }, [svg]);

  if (!cleaned) return null;

  return (
    <div
      role="img"
      aria-label="Geometry figure"
      className={
        "geometry-figure mx-auto my-3 flex max-h-56 w-full max-w-md items-center justify-center " +
        "[&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:max-w-full " +
        (className ?? "")
      }
      // The SVG is pre-sanitized via DOMPurify above. Required for
      // inline rendering since SVG can't be loaded as a React node
      // tree directly without a parser.
      dangerouslySetInnerHTML={{ __html: cleaned }}
    />
  );
}
