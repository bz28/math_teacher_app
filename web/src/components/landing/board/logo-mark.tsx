import { MARK_BOTTOM, MARK_STROKE, MARK_TOP, MARK_VIEWBOX } from "@/lib/brand-mark";

/**
 * The Veradic mark beside the wordmark. The clean bar takes the text colour
 * (currentColor); the hand-drawn bar takes `accent`: green on light bands,
 * sun yellow on the board.
 */
export function LogoMark({ accent = "#0F6B4C", width = 32 }: { accent?: string; width?: number }) {
  return (
    <svg width={width} height={(width * 30) / 48} viewBox={MARK_VIEWBOX} aria-hidden="true">
      <path d={MARK_TOP} fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" />
      <path d={MARK_BOTTOM} fill="none" stroke={accent} strokeWidth={MARK_STROKE} strokeLinecap="round" />
    </svg>
  );
}
