import { ImageResponse } from "next/og";

export const alt = "Veradic AI — Your AI Chemistry Tutor. Step-by-step solutions for reactions, stoichiometry, and more.";
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
          background: "linear-gradient(135deg, #0D2B22 0%, #0D0C14 60%, #0D3028 100%)",
          padding: "60px 80px",
          fontFamily: "Inter, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -120,
            right: -120,
            width: 500,
            height: 500,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,184,148,0.25) 0%, transparent 70%)",
            display: "flex",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "linear-gradient(135deg, #00B894 0%, #55EFC4 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 512 512" fill="none">
              <path d="M160 148 L256 380 L352 148" stroke="white" strokeWidth="52" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="352" cy="148" r="18" fill="#55EFC4" opacity="0.9" />
            </svg>
          </div>
          <span style={{ color: "#55EFC4", fontSize: 24, fontWeight: 600, letterSpacing: 1.5 }}>VERADIC AI</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 24 }}>
          <div style={{ fontSize: 60, fontWeight: 800, color: "#FFFFFF", lineHeight: 1.15, letterSpacing: -1, display: "flex", flexDirection: "column" }}>
            <span>Your AI Chemistry Tutor</span>
          </div>
          <div style={{ fontSize: 28, color: "#7BC5A5", lineHeight: 1.5, maxWidth: 700 }}>
            Step-by-step solutions for reactions, stoichiometry, organic chemistry, and more.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#00B894", fontSize: 20, fontWeight: 600 }}>veradicai.com/subjects/chemistry</span>
          <div style={{ display: "flex", gap: 12 }}>
            {["Reactions", "Stoichiometry", "Acids & Bases", "Organic"].map((tag) => (
              <div key={tag} style={{ background: "rgba(0,184,148,0.15)", border: "1px solid rgba(0,184,148,0.3)", borderRadius: 100, padding: "8px 20px", color: "#55EFC4", fontSize: 15, fontWeight: 500 }}>
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
