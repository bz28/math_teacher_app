import { ImageResponse } from "next/og";

export const alt =
  "Veradic AI — Measures understanding, grades homework, and gives every student endless practice.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #102018 0%, #0D0C14 55%, #0A2418 100%)",
          padding: "60px 80px",
          fontFamily: "Inter, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background accent glow */}
        <div
          style={{
            position: "absolute",
            top: -120,
            right: -120,
            width: 500,
            height: 500,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(63,166,122,0.28) 0%, transparent 70%)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -80,
            left: -80,
            width: 350,
            height: 350,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(91,194,152,0.18) 0%, transparent 70%)",
            display: "flex",
          }}
        />

        {/* Top: Logo mark + brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "linear-gradient(135deg, #1F6B47 0%, #0A3D2A 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 512 512"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M160 148 L256 380 L352 148"
                stroke="white"
                strokeWidth="52"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="352" cy="148" r="18" fill="#5BC298" opacity="0.9" />
            </svg>
          </div>
          <span style={{ color: "#5BC298", fontSize: 24, fontWeight: 600, letterSpacing: 1.5 }}>
            VERADIC AI
          </span>
        </div>

        {/* Center: Headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              color: "#FFFFFF",
              lineHeight: 1.15,
              letterSpacing: -1,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Built for your classroom.</span>
          </div>
          <div
            style={{
              fontSize: 28,
              color: "#9DB5A6",
              lineHeight: 1.5,
              maxWidth: 900,
            }}
          >
            Measures what students understand. Grades their homework. Gives every student endless practice.
          </div>
        </div>

        {/* Bottom: URL + tags */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: "#5BC298", fontSize: 20, fontWeight: 600 }}>veradicai.com</span>
          <div style={{ display: "flex", gap: 12 }}>
            {["Integrity Checks", "AI Grading", "Endless Practice"].map((tag) => (
              <div
                key={tag}
                style={{
                  background: "rgba(63,166,122,0.15)",
                  border: "1px solid rgba(63,166,122,0.3)",
                  borderRadius: 100,
                  padding: "8px 20px",
                  color: "#5BC298",
                  fontSize: 15,
                  fontWeight: 500,
                }}
              >
                {tag}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
