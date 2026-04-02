import { ImageResponse } from "next/og";

export const alt = "Veradic AI — Your AI Physics Tutor. Step-by-step solutions for mechanics, energy, waves, and more.";
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
          background: "linear-gradient(135deg, #0D1F30 0%, #0D0C14 60%, #0D2540 100%)",
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
            background: "radial-gradient(circle, rgba(9,132,227,0.25) 0%, transparent 70%)",
            display: "flex",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "linear-gradient(135deg, #0984E3 0%, #74B9FF 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 512 512" fill="none">
              <path d="M160 148 L256 380 L352 148" stroke="white" strokeWidth="52" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="352" cy="148" r="18" fill="#74B9FF" opacity="0.9" />
            </svg>
          </div>
          <span style={{ color: "#74B9FF", fontSize: 24, fontWeight: 600, letterSpacing: 1.5 }}>VERADIC AI</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 24 }}>
          <div style={{ fontSize: 60, fontWeight: 800, color: "#FFFFFF", lineHeight: 1.15, letterSpacing: -1, display: "flex", flexDirection: "column" }}>
            <span>Your AI Physics Tutor</span>
          </div>
          <div style={{ fontSize: 28, color: "#7BA4C5", lineHeight: 1.5, maxWidth: 700 }}>
            Step-by-step solutions for mechanics, thermodynamics, waves, electricity, and more.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#0984E3", fontSize: 20, fontWeight: 600 }}>veradicai.com/subjects/physics</span>
          <div style={{ display: "flex", gap: 12 }}>
            {["Mechanics", "Energy", "Waves", "Electricity"].map((tag) => (
              <div key={tag} style={{ background: "rgba(9,132,227,0.15)", border: "1px solid rgba(9,132,227,0.3)", borderRadius: 100, padding: "8px 20px", color: "#74B9FF", fontSize: 15, fontWeight: 500 }}>
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
