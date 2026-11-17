import { ImageResponse } from "next/og";
import { BRAND, MARK_BOTTOM, MARK_STROKE, MARK_TOP } from "@/lib/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the Balanced mark on the board green. iOS rounds the corners itself. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND.board }}>
        <svg width="144" height="144" viewBox="0 0 64 64">
          <g transform="translate(32 32) scale(0.8) translate(-32 -32.6)">
            <path d={MARK_TOP} fill="none" stroke={BRAND.chalk} strokeWidth={MARK_STROKE} strokeLinecap="round" />
            <path d={MARK_BOTTOM} fill="none" stroke={BRAND.sun} strokeWidth={MARK_STROKE} strokeLinecap="round" />
          </g>
        </svg>
      </div>
    ),
    { ...size }
  );
}
