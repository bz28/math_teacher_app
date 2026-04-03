import { ImageResponse } from "next/og";

interface SubjectOgConfig {
  title: string;
  subtitle: string;
  url: string;
  tags: string[];
  /** Primary color for accents, e.g. "#6C5CE7" */
  color: string;
  /** Lighter shade for text/dots, e.g. "#A29BFE" */
  colorLight: string;
  /** Background gradient stops: [start, mid, end] */
  bgGradient: [string, string, string];
}

export const ogSize = { width: 1200, height: 630 };

export function createSubjectOgImage(config: SubjectOgConfig) {
  const { title, subtitle, url, tags, color, colorLight, bgGradient } = config;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(135deg, ${bgGradient[0]} 0%, ${bgGradient[1]} 60%, ${bgGradient[2]} 100%)`,
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
            background: `radial-gradient(circle, ${color}40 0%, transparent 70%)`,
            display: "flex",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: `linear-gradient(135deg, ${color} 0%, ${colorLight} 100%)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 512 512" fill="none">
              <path d="M160 148 L256 380 L352 148" stroke="white" strokeWidth="52" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="352" cy="148" r="18" fill={colorLight} opacity="0.9" />
            </svg>
          </div>
          <span style={{ color: colorLight, fontSize: 24, fontWeight: 600, letterSpacing: 1.5 }}>VERADIC AI</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 24 }}>
          <div style={{ fontSize: 60, fontWeight: 800, color: "#FFFFFF", lineHeight: 1.15, letterSpacing: -1, display: "flex", flexDirection: "column" }}>
            <span>{title}</span>
          </div>
          <div style={{ fontSize: 28, color: `${colorLight}AA`, lineHeight: 1.5, maxWidth: 700 }}>
            {subtitle}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color, fontSize: 20, fontWeight: 600 }}>{url}</span>
          <div style={{ display: "flex", gap: 12 }}>
            {tags.map((tag) => (
              <div key={tag} style={{ background: `${color}26`, border: `1px solid ${color}4D`, borderRadius: 100, padding: "8px 20px", color: colorLight, fontSize: 15, fontWeight: 500 }}>
                {tag}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...ogSize }
  );
}
