import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #7C6FF0 0%, #5A4BD1 100%)",
          borderRadius: 38,
        }}
      >
        <svg
          width="120"
          height="120"
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
    ),
    { ...size }
  );
}
