import DOMPurify from "dompurify";

/**
 * Sanitize an inline SVG string before `dangerouslySetInnerHTML`.
 *
 * Both inline-SVG surfaces use this (MathText's LaTeX→SVG and the geometry
 * FigureDisplay). The SVG is produced server-side, but it originates from
 * LLM-shaped data, so this is defense-in-depth: the `svg` profile blocks
 * `<script>` / `<foreignObject>` / `on*` handlers, and the explicit tag/attr
 * allowlist keeps the geometry + text primitives both surfaces need. One
 * shared definition so the two surfaces can't drift to divergent (and subtly
 * unsafe) configs.
 */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: [
      "svg", "path", "circle", "rect", "line", "polyline", "polygon",
      "text", "g", "defs", "marker", "tspan",
    ],
    ADD_ATTR: [
      "viewBox", "d", "cx", "cy", "r", "x", "y", "x1", "y1", "x2", "y2",
      "width", "height", "fill", "stroke", "stroke-width", "font-size",
      "text-anchor", "transform", "points", "marker-end", "marker-start",
    ],
  });
}
