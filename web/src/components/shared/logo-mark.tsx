export function LogoMark({ size = 28 }: { size?: number }) {
  const padding = size * 0.15;
  const svgSize = size - padding * 2;

  return (
    <div
      // Fixed brand green — NOT the `primary` token, which the per-subject
      // theme ([data-subject="…"]) reassigns. The brand mark stays the same
      // deep green on every subject and in dark mode; identity shouldn't
      // shift with the page you're on.
      className="flex items-center justify-center rounded-[6px] bg-gradient-to-br from-[#0E5238] to-[#2F8F66]"
      style={{ width: size, height: size, padding }}
    >
      <svg
        width={svgSize}
        height={svgSize}
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
        <circle cx="352" cy="148" r="18" fill="#FFFFFF" opacity="0.95" />
      </svg>
    </div>
  );
}
