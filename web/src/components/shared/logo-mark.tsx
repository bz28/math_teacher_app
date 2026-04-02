export function LogoMark({ size = 28 }: { size?: number }) {
  const padding = size * 0.15;
  const svgSize = size - padding * 2;

  return (
    <div
      className="flex items-center justify-center rounded-[6px] bg-gradient-to-br from-primary to-primary-light"
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
        <circle cx="352" cy="148" r="18" fill="#A29BFE" opacity="0.9" />
      </svg>
    </div>
  );
}
