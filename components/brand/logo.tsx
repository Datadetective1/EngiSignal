import { cn } from '@/lib/utils';

/**
 * The EngiSignal mark.
 *
 * An abstract E built from three measurement bars of differing length — a
 * signal-strength reading — anchored by a node point that sits on the axis of
 * the longest bar. Engineering precision (the ruled bars, the exact geometry)
 * meets signal (the node and its emitted arc).
 *
 * Designed to survive 16px: the bars carry the identity, the node carries the
 * accent, and the arc drops away below 24px where it would turn to mud.
 */

export interface LogoMarkProps {
  size?: number;
  className?: string;
  /** Monochrome renders entirely in currentColor, for one-colour contexts. */
  monochrome?: boolean;
  /** Hide the emitted arc regardless of size. */
  compact?: boolean;
}

export function LogoMark({ size = 28, className, monochrome = false, compact = false }: LogoMarkProps) {
  const showArc = !compact && size >= 24;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="EngiSignal"
      className={cn('shrink-0', className)}
    >
      {/* Vertical stem — the measurement axis. */}
      <rect x="4" y="6" width="2.6" height="20" rx="1.3" fill="currentColor" opacity="0.92" />

      {/* Three signal bars, ascending then resolving: the abstract E. */}
      <rect x="9.2" y="6" width="9.4" height="2.6" rx="1.3" fill="currentColor" opacity="0.55" />
      <rect x="9.2" y="14.7" width="14.2" height="2.6" rx="1.3" fill="currentColor" opacity="0.92" />
      <rect x="9.2" y="23.4" width="7.2" height="2.6" rx="1.3" fill="currentColor" opacity="0.55" />

      {/* The node — where measurement becomes signal. */}
      <circle cx="25.9" cy="16" r="3.1" fill={monochrome ? 'currentColor' : 'var(--es-accent)'} />

      {showArc && (
        <path
          d="M29.4 11.2a8.4 8.4 0 0 1 0 9.6"
          stroke={monochrome ? 'currentColor' : 'var(--es-accent)'}
          strokeWidth="1.7"
          strokeLinecap="round"
          opacity="0.45"
        />
      )}
    </svg>
  );
}

export interface LogoProps {
  size?: number;
  className?: string;
  monochrome?: boolean;
  /** Render the mark alone, without the wordmark. */
  markOnly?: boolean;
}

export function Logo({ size = 26, className, monochrome = false, markOnly = false }: LogoProps) {
  if (markOnly) return <LogoMark size={size} monochrome={monochrome} className={className} />;

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} monochrome={monochrome} />
      <span
        className="font-semibold tracking-[-0.021em]"
        style={{ fontSize: size * 0.66, lineHeight: 1 }}
      >
        EngiSignal
      </span>
    </span>
  );
}

/**
 * Favicon / app icon: the mark on a graphite tile, so it holds its own against
 * a browser's light or dark tab strip.
 */
export function LogoIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" role="img" aria-label="EngiSignal">
      <rect width="32" height="32" rx="7" fill="#0E1116" />
      <g transform="translate(2.6, 2.6) scale(0.84)">
        <rect x="4" y="6" width="2.6" height="20" rx="1.3" fill="#F1F3F7" opacity="0.92" />
        <rect x="9.2" y="6" width="9.4" height="2.6" rx="1.3" fill="#F1F3F7" opacity="0.5" />
        <rect x="9.2" y="14.7" width="14.2" height="2.6" rx="1.3" fill="#F1F3F7" opacity="0.92" />
        <rect x="9.2" y="23.4" width="7.2" height="2.6" rx="1.3" fill="#F1F3F7" opacity="0.5" />
        <circle cx="25.9" cy="16" r="3.1" fill="#4DA3FF" />
      </g>
    </svg>
  );
}
