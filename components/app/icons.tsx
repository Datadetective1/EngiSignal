/**
 * A minimal, consistent icon set drawn on a 20px grid with a 1.6 stroke.
 * Hand-drawn rather than imported so the whole set shares one optical weight
 * and adds no dependency.
 */

type IconProps = { className?: string; size?: number };

function Svg({ children, className, size = 17 }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconIntelligence = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 13.5 7 8.5l3.2 3L17 4.5" />
    <circle cx="17" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
    <path d="M3 16.5h14" opacity="0.45" />
  </Svg>
);

export const IconPortfolio = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.8" y="3.5" width="14.4" height="13" rx="2" />
    <path d="M2.8 8h14.4M7.5 8v8.5" />
  </Svg>
);

export const IconRenewal = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6v4.3l2.8 1.8" />
  </Svg>
);

export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.6" cy="7.4" r="2.8" />
    <path d="M2.6 16.4c.5-2.7 2.5-4.3 5-4.3s4.5 1.6 5 4.3" />
    <path d="M13.4 5.2a2.6 2.6 0 0 1 0 4.9M14.6 12.3c1.7.5 2.7 1.9 3 4.1" opacity="0.55" />
  </Svg>
);

export const IconForecast = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 15.5 7.5 11l3 2.6 3.4-5" />
    <path d="M14 8.6h3v3" />
    <path d="M3 4v13h14" opacity="0.4" />
  </Svg>
);

export const IconCost = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M12.2 7.2c-.6-.7-1.4-1-2.4-1-1.4 0-2.3.7-2.3 1.8 0 2.4 4.9 1.2 4.9 3.7 0 1.2-1 2-2.6 2-1.1 0-2-.4-2.6-1.1" />
    <path d="M10 5v10" opacity="0.5" />
  </Svg>
);

export const IconDecisions = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h8" opacity="0.5" />
    <path d="m13.4 14.2 1.6 1.7 3-3.4" />
  </Svg>
);

export const IconData = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="10" cy="5.4" rx="6.4" ry="2.5" />
    <path d="M3.6 5.4v9.2c0 1.4 2.9 2.5 6.4 2.5s6.4-1.1 6.4-2.5V5.4" />
    <path d="M3.6 10c0 1.4 2.9 2.5 6.4 2.5s6.4-1.1 6.4-2.5" opacity="0.55" />
  </Svg>
);

export const IconAsk = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 9.4c0 3.3-3.1 6-7 6-.85 0-1.66-.13-2.4-.36L3.4 16.4l1.1-2.8A5.7 5.7 0 0 1 3 9.4c0-3.3 3.1-6 7-6s7 2.7 7 6Z" />
    <path d="M7.4 9.4h5.2" opacity="0.6" />
  </Svg>
);

export const IconScenario = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 6.5h13M3.5 13.5h13" opacity="0.45" />
    <circle cx="7.6" cy="6.5" r="2.1" fill="var(--es-bg)" />
    <circle cx="13" cy="13.5" r="2.1" fill="var(--es-bg)" />
  </Svg>
);

export const IconBrief = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 2.8h6.6L16 7.2v10H5z" />
    <path d="M11.4 2.8v4.4H16" opacity="0.6" />
    <path d="M7.6 11h5.2M7.6 13.8h3.4" opacity="0.6" />
  </Svg>
);

export const IconReclaim = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16.4 10a6.4 6.4 0 1 1-2-4.6" />
    <path d="M16.6 3.4v3.4h-3.4" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="2.6" />
    <path d="M10 2.6v1.8M10 15.6v1.8M17.4 10h-1.8M4.4 10H2.6M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3M15.2 15.2l-1.3-1.3M6.1 6.1 4.8 4.8" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10h11M11 6l4 4-4 4" />
  </Svg>
);

export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4H4.5v11.5H16V12" />
    <path d="M11 3.5h5.5V9M16 3.5 9.5 10" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3v9M6.4 8.6 10 12.2l3.6-3.6" />
    <path d="M3.6 15.4h12.8" />
  </Svg>
);

export const IconPrint = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 7.5V3h8v4.5" />
    <rect x="3.2" y="7.5" width="13.6" height="6" rx="1.6" />
    <path d="M6 11.5h8V17H6z" />
  </Svg>
);

export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="m7.5 4.5 5 5.5-5 5.5" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 10.4 3.4 3.5 7.6-8" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3.4 17.2 16H2.8z" />
    <path d="M10 8v3.4M10 13.6v.1" />
  </Svg>
);
