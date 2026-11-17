import { ImageResponse } from "next/og";

/**
 * The link-preview card for the marketing site, in the "At the Board" look:
 * school-bus yellow, the headline in ink on the left, and a small framed
 * chalkboard on the right with one exchange in chalk (the problem, Veradic's
 * question in yellow chalk, the student's answer).
 */
export interface OgConfig {
  title: string;
  subtitle: string;
  url: string;
  board: { problem: string; ask: string; reply: string };
}

export const ogSize = { width: 1200, height: 630 };

const SUN = "#FFCE3A";
const INK = "#16241D";
const BOARD = "#14644A";
const FRAME = "#8C6A44";
const CHALK = "#F6F8F0";
const CHALK_YELLOW = "#FFD84A";

export function createOgImage({ title, subtitle, url, board }: OgConfig) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: SUN,
          padding: "56px 64px",
          gap: 48,
          alignItems: "center",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, height: "100%", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, color: INK, fontSize: 30, fontWeight: 800 }}>
            <svg width="40" height="40" viewBox="0 0 28 28">
              <circle cx="14" cy="14" r="12.5" fill="none" stroke={INK} strokeWidth="2.2" strokeDasharray="70 9" />
              <path d="M8.5 9.5 L14 19.5 L19.5 9.5" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Veradic
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ fontSize: 56, fontWeight: 800, color: INK, lineHeight: 1.05, letterSpacing: -1.5 }}>{title}</div>
            <div style={{ fontSize: 26, color: INK, opacity: 0.8, lineHeight: 1.4 }}>{subtitle}</div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: INK }}>{url}</div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 420,
            background: BOARD,
            border: `14px solid ${FRAME}`,
            borderRadius: 10,
            padding: "30px 30px",
            gap: 18,
            transform: "rotate(2deg)",
          }}
        >
          <div style={{ fontSize: 32, color: CHALK }}>{board.problem}</div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              border: `2px dashed ${CHALK_YELLOW}`,
              borderRadius: 10,
              padding: "12px 16px",
              color: CHALK_YELLOW,
              fontSize: 24,
              lineHeight: 1.35,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700 }}>Veradic asked</span>
            {board.ask}
          </div>
          <div style={{ fontSize: 24, color: CHALK, lineHeight: 1.35 }}>{board.reply}</div>
        </div>
      </div>
    ),
    { ...ogSize },
  );
}
