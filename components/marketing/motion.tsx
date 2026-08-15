'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Marketing motion primitives.
 *
 * Built on IntersectionObserver and CSS rather than a runtime animation library,
 * so the landing page ships almost no JavaScript for its reveals. Reduced-motion
 * is honoured globally in CSS, and additionally short-circuited here so counters
 * jump straight to their final value rather than animating invisibly.
 */

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useInView<T extends HTMLElement>(options?: { once?: boolean; threshold?: number }) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (options?.once !== false) observer.disconnect();
          } else if (options?.once === false) {
            setInView(false);
          }
        }
      },
      { threshold: options?.threshold ?? 0.2, rootMargin: '0px 0px -8% 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [options?.once, options?.threshold]);

  return { ref, inView };
}

/** Fade and rise into view once. */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article' | 'header';
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <Tag
      ref={ref as never}
      className={cn('transition-none', className)}
      style={
        inView
          ? { animation: `es-fade-up 0.75s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms both` }
          : { opacity: 0 }
      }
    >
      {children}
    </Tag>
  );
}

/** Count a number up when it first enters the viewport. */
export function CountUp({
  value,
  format,
  durationMs = 1200,
  className,
}: {
  value: number;
  format: (value: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;

    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value, durationMs]);

  return (
    <span ref={ref} className={className} suppressHydrationWarning>
      {format(inView ? display : 0)}
    </span>
  );
}

/** Rotate through a list of strings, one at a time. */
export function RotatingText({
  items,
  intervalMs = 3200,
  className,
}: {
  items: readonly string[];
  intervalMs?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const { ref, inView } = useInView<HTMLSpanElement>({ once: false });

  useEffect(() => {
    if (!inView || items.length <= 1) return;
    if (prefersReducedMotion()) return;

    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % items.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [inView, items.length, intervalMs]);

  return (
    <span ref={ref} className={className} key={index} style={{ animation: 'es-fade 0.5s ease both' }}>
      {items[index]}
    </span>
  );
}
