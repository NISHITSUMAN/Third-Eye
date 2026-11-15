export function ThirdEyeMark({
  size = 22,
  animate = false,
  className,
}: {
  size?: number;
  animate?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={className}
      style={{
        display: 'block',
        color: 'currentColor',
        ...(animate ? { strokeDasharray: 300, animation: 'draw-ring 1.8s ease-out forwards' } : {}),
      }}
    >
      <path
        d="M4 24 C 12 12, 36 12, 44 24 C 36 36, 12 36, 4 24 Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <ellipse
        cx="24"
        cy="24"
        rx="20"
        ry="7"
        stroke="currentColor"
        strokeOpacity=".35"
        strokeWidth="1"
        transform="rotate(-24 24 24)"
      />
      <circle cx="24" cy="24" r="6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="24" cy="24" r="2.2" fill="currentColor" />
    </svg>
  );
}
