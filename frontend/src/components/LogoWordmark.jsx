import { useMemo } from 'react';

function isLatinWordmarkLabel(label) {
  const s = String(label || '').trim();
  if (!s) return false;
  // If it contains any non-latin letters (e.g. Chinese), treat as non-Latin.
  return /^[A-Za-z][A-Za-z0-9 _-]*$/.test(s);
}

export default function LogoWordmark({ label }) {
  const normalizedText = useMemo(() => {
    const s = String(label || '').trim();
    if (!s) return 'MY WORTH TRACK';
    return isLatinWordmarkLabel(s) ? s.toUpperCase() : s;
  }, [label]);

  return (
    <svg
      className="logoWordmark"
      width="220"
      height="28"
      viewBox="0 0 220 28"
      role="img"
      aria-label={normalizedText}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="220" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="1" />
          <stop offset="1" stopColor="#b6fdff" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="underlineGrad" x1="35" y1="20" x2="215" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.95" />
          <stop offset="1" stopColor="#22c55e" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Icon */}
      <g transform="translate(0,0)">
        <circle cx="16" cy="14" r="10.5" fill="rgba(34, 211, 238, 0.10)" stroke="url(#logoGrad)" strokeWidth="1.2" />
        <path
          d="M14 17 L14 11 L18 11"
          fill="none"
          stroke="url(#logoGrad)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M13 18.5 C14.8 18.2 16.4 17.3 17.6 16"
          fill="none"
          stroke="#22c55e"
          strokeOpacity="0.35"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </g>

      {/* Text */}
      <text
        x="32"
        y="17"
        fill="#b6fdff"
        fontSize="12.5"
        fontWeight="800"
        letterSpacing="0.18em"
        style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial' }}
      >
        {normalizedText}
      </text>

      {/* Underline */}
      <path d="M32 22.2 H214" stroke="url(#underlineGrad)" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

