/**
 * The hero visual: an engineering software intelligence network.
 *
 *   engineering applications → usage, users, contracts, cost
 *     → EngiSignal → decisions
 *
 * Pure SVG with CSS animation. No canvas, no WebGL, no animation library — the
 * whole thing costs zero client JavaScript, and the global reduced-motion rule
 * stops every particle without removing any information from the diagram.
 */

const SOURCES = [
  { label: 'Ansys', y: 44 },
  { label: 'MATLAB', y: 100 },
  { label: 'CATIA', y: 156 },
  { label: 'Siemens NX', y: 212 },
  { label: 'Altair', y: 268 },
  { label: 'Autodesk', y: 324 },
  { label: 'Cadence', y: 380 },
  { label: 'Synopsys', y: 436 },
];

const INPUTS = [
  { label: 'Usage', y: 128 },
  { label: 'Users', y: 200 },
  { label: 'Contracts', y: 272 },
  { label: 'Cost', y: 344 },
];

const OUTCOMES = [
  { label: '$410K opportunity', y: 96 },
  { label: '318 recommended', y: 170 },
  { label: 'P95 275', y: 244 },
  { label: '43 reclaim candidates', y: 318 },
  { label: 'Renewal in 58 days', y: 392 },
];

const CORE = { x: 470, y: 240 };

export function HeroNetwork({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 940 490"
      className={className}
      role="img"
      aria-label="Engineering applications feed usage, user, contract and cost data into EngiSignal, which produces decisions such as a recommended quantity of 318 licenses and a $410,000 annual opportunity."
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="es-hero-core" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--es-accent)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--es-aqua)" stopOpacity="0.75" />
        </linearGradient>
        <radialGradient id="es-hero-glow">
          <stop offset="0%" stopColor="var(--es-accent)" stopOpacity="0.24" />
          <stop offset="100%" stopColor="var(--es-accent)" stopOpacity="0" />
        </radialGradient>
        <filter id="es-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* Ambient light behind the core, kept subtle. */}
      <circle cx={CORE.x} cy={CORE.y} r="150" fill="url(#es-hero-glow)" />

      {/* ── Source → input rail ─────────────────────────────────────────── */}
      {SOURCES.map((source, index) => {
        const targetY = INPUTS[index % INPUTS.length]?.y ?? CORE.y;
        const path = `M148,${source.y} C210,${source.y} 220,${targetY} 274,${targetY}`;
        return (
          <g key={source.label}>
            <path d={path} fill="none" stroke="var(--es-border-strong)" strokeWidth="1" opacity="0.55" />
            <circle r="2.1" fill="var(--es-accent)" opacity="0.85">
              <animateMotion
                dur={`${4.4 + index * 0.36}s`}
                repeatCount="indefinite"
                begin={`${index * 0.42}s`}
                path={path}
              />
            </circle>
          </g>
        );
      })}

      {/* ── Source nodes ────────────────────────────────────────────────── */}
      {SOURCES.map((source) => (
        <g key={`node-${source.label}`}>
          <rect
            x="16"
            y={source.y - 15}
            width="132"
            height="30"
            rx="7"
            fill="var(--es-surface)"
            stroke="var(--es-border)"
          />
          <circle cx="33" cy={source.y} r="3" fill="var(--es-fg-subtle)" />
          <text
            x="46"
            y={source.y + 4}
            fontSize="12.5"
            fill="var(--es-fg-muted)"
            fontWeight="500"
          >
            {source.label}
          </text>
        </g>
      ))}

      {/* ── Input → core ────────────────────────────────────────────────── */}
      {INPUTS.map((input, index) => {
        const path = `M382,${input.y} C420,${input.y} 428,${CORE.y} ${CORE.x - 62},${CORE.y}`;
        return (
          <g key={input.label}>
            <path d={path} fill="none" stroke="var(--es-border-strong)" strokeWidth="1.1" opacity="0.7" />
            <circle r="2.4" fill="var(--es-aqua)">
              <animateMotion dur={`${2.6 + index * 0.3}s`} repeatCount="indefinite" begin={`${index * 0.5}s`} path={path} />
            </circle>
            <rect
              x="274"
              y={input.y - 14}
              width="108"
              height="28"
              rx="6"
              fill="var(--es-surface-2)"
              stroke="var(--es-border)"
            />
            <text x="328" y={input.y + 4} fontSize="12" fill="var(--es-fg)" fontWeight="500" textAnchor="middle">
              {input.label}
            </text>
          </g>
        );
      })}

      {/* ── The core ────────────────────────────────────────────────────── */}
      <g>
        <circle cx={CORE.x} cy={CORE.y} r="58" fill="var(--es-accent)" opacity="0.14" filter="url(#es-soft)" />
        <circle cx={CORE.x} cy={CORE.y} r="46" fill="var(--es-surface)" stroke="url(#es-hero-core)" strokeWidth="1.8" />

        {/* The EngiSignal mark, drawn at the centre of its own network. */}
        <g transform={`translate(${CORE.x - 21}, ${CORE.y - 21}) scale(1.32)`}>
          <rect x="4" y="6" width="2.4" height="20" rx="1.2" fill="var(--es-fg)" opacity="0.9" />
          <rect x="9.2" y="6" width="8.6" height="2.4" rx="1.2" fill="var(--es-fg)" opacity="0.5" />
          <rect x="9.2" y="14.8" width="13" height="2.4" rx="1.2" fill="var(--es-fg)" opacity="0.9" />
          <rect x="9.2" y="23.6" width="6.6" height="2.4" rx="1.2" fill="var(--es-fg)" opacity="0.5" />
          <circle cx="24.6" cy="16" r="2.8" fill="var(--es-accent)" />
        </g>

        {/* Two slow orbit rings — motion that says "processing", not "loading". */}
        <circle
          cx={CORE.x}
          cy={CORE.y}
          r="66"
          fill="none"
          stroke="var(--es-accent)"
          strokeWidth="1"
          strokeDasharray="3 9"
          opacity="0.45"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`0 ${CORE.x} ${CORE.y}`}
            to={`360 ${CORE.x} ${CORE.y}`}
            dur="34s"
            repeatCount="indefinite"
          />
        </circle>
        <circle
          cx={CORE.x}
          cy={CORE.y}
          r="82"
          fill="none"
          stroke="var(--es-aqua)"
          strokeWidth="0.9"
          strokeDasharray="2 14"
          opacity="0.3"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`360 ${CORE.x} ${CORE.y}`}
            to={`0 ${CORE.x} ${CORE.y}`}
            dur="52s"
            repeatCount="indefinite"
          />
        </circle>
      </g>

      {/* ── Core → outcomes ─────────────────────────────────────────────── */}
      {OUTCOMES.map((outcome, index) => {
        const path = `M${CORE.x + 62},${CORE.y} C620,${CORE.y} 626,${outcome.y} 676,${outcome.y}`;
        return (
          <g key={outcome.label}>
            <path d={path} fill="none" stroke="var(--es-border-strong)" strokeWidth="1.1" opacity="0.7" />
            <circle r="2.6" fill="var(--es-positive)">
              <animateMotion dur={`${3 + index * 0.34}s`} repeatCount="indefinite" begin={`${1 + index * 0.4}s`} path={path} />
            </circle>
          </g>
        );
      })}

      {/* ── Outcome cards ───────────────────────────────────────────────── */}
      {OUTCOMES.map((outcome) => (
        <g key={`card-${outcome.label}`}>
          <rect
            x="676"
            y={outcome.y - 17}
            width="248"
            height="34"
            rx="8"
            fill="var(--es-surface)"
            stroke="var(--es-border-strong)"
          />
          <circle cx="696" cy={outcome.y} r="3.2" fill="var(--es-positive)" />
          <text x="710" y={outcome.y + 4.5} fontSize="13" fill="var(--es-fg)" fontWeight="500">
            {outcome.label}
          </text>
        </g>
      ))}

      {/* ── Column captions ─────────────────────────────────────────────── */}
      <text x="16" y="18" fontSize="10.5" fill="var(--es-fg-subtle)" letterSpacing="1.4" fontWeight="500">
        ENGINEERING SOFTWARE
      </text>
      <text x="274" y="86" fontSize="10.5" fill="var(--es-fg-subtle)" letterSpacing="1.4" fontWeight="500">
        SIGNALS
      </text>
      <text x="676" y="52" fontSize="10.5" fill="var(--es-fg-subtle)" letterSpacing="1.4" fontWeight="500">
        DECISIONS
      </text>
    </svg>
  );
}
