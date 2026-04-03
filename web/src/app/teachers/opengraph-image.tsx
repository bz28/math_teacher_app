import { ImageResponse } from "next/og";
import { SITE_URL } from "@/lib/seo";

export const alt =
  "Veradic AI for Teachers — A personal AI tutor for every student in your classroom.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TeachersOpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #1A1630 0%, #0D0C14 60%, #1C1040 100%)",
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
            background: "radial-gradient(circle, rgba(108,92,231,0.25) 0%, transparent 70%)",
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
            background: "radial-gradient(circle, rgba(162,155,254,0.15) 0%, transparent 70%)",
            display: "flex",
          }}
        />

        {/* Top: Logo mark + brand + badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "linear-gradient(135deg, #7C6FF0 0%, #5A4BD1 100%)",
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
              <circle cx="352" cy="148" r="18" fill="#A29BFE" opacity="0.9" />
            </svg>
          </div>
          <span style={{ color: "#A29BFE", fontSize: 24, fontWeight: 600, letterSpacing: 1.5 }}>
            VERADIC AI
          </span>
          <div
            style={{
              background: "rgba(108,92,231,0.2)",
              border: "1px solid rgba(108,92,231,0.4)",
              borderRadius: 100,
              padding: "6px 16px",
              color: "#A29BFE",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            For Schools & Teachers
          </div>
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
              fontSize: 58,
              fontWeight: 800,
              color: "#FFFFFF",
              lineHeight: 1.15,
              letterSpacing: -1,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>AI-Powered Tutoring</span>
            <span>for Your Classroom</span>
          </div>
          <div
            style={{
              fontSize: 22,
              color: "#9B95C5",
              lineHeight: 1.5,
              maxWidth: 750,
            }}
          >
            {"A personal AI tutor for every student in your classroom: step-by-step guidance at every student's pace, automated grading, endless practice problems, and actionable insights — so you can spend your time where it matters most."}
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
          <span style={{ color: "#6C5CE7", fontSize: 20, fontWeight: 600 }}>{`${SITE_URL.replace(/^https?:\/\//, "")}/teachers`}</span>
          <div style={{ display: "flex", gap: 12 }}>
            {["Personal AI Tutor", "Auto Grading", "Course Management"].map((tag) => (
              <div
                key={tag}
                style={{
                  background: "rgba(108,92,231,0.15)",
                  border: "1px solid rgba(108,92,231,0.3)",
                  borderRadius: 100,
                  padding: "8px 20px",
                  color: "#A29BFE",
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
