import { BRAND, MARK_BOTTOM, MARK_STROKE, MARK_TOP } from "@/lib/brand-mark";

/**
 * The app's square brand tile: the Balanced mark in chalk and sun yellow on
 * the board green. Fixed colours, NOT the `primary` token, which the
 * per-subject theme ([data-subject="…"]) reassigns: identity shouldn't shift
 * with the page you're on, or in dark mode.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="flex-none">
      <rect width="64" height="64" rx="14" fill={BRAND.board} />
      <g transform="translate(32 32) scale(0.8) translate(-32 -32.6)">
        <path d={MARK_TOP} fill="none" stroke={BRAND.chalk} strokeWidth={MARK_STROKE} strokeLinecap="round" />
        <path d={MARK_BOTTOM} fill="none" stroke={BRAND.sun} strokeWidth={MARK_STROKE} strokeLinecap="round" />
      </g>
    </svg>
  );
}
