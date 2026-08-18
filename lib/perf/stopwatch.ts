/**
 * ── MEASURING BEFORE CHANGING ───────────────────────────────────────────────
 *
 * Three times now a plausible explanation for a slow path has been wrong. The
 * parallel-paging change made every authenticated page fail; the read cost that
 * "obviously" lived in deserialization turned out to be `count(*)` under RLS at
 * 1,464ms. Both were found only after something recorded where the time
 * actually went, and neither would have been found by reasoning about the code.
 *
 * So this records phases rather than totals. A total tells you an import took
 * twenty seconds. Phases tell you which of parse, fingerprint or persistence
 * owns them, and persistence broken down per table tells you whether the cost
 * is per row or per round trip — which are fixed by opposite changes.
 */

export interface Phase {
  name: string;
  ms: number;
  /** Round trips, rows, bytes — whatever makes the number interpretable. */
  detail?: Record<string, number>;
}

export interface Stopwatch {
  /** Times `work`, records it under `name`, and returns its result. */
  phase<T>(name: string, work: () => Promise<T>, detail?: () => Record<string, number>): Promise<T>;
  /** Records a phase that was timed by hand. */
  record(name: string, ms: number, detail?: Record<string, number>): void;
  phases(): Phase[];
  totalMs(): number;
  /**
   * `Server-Timing` is read by browser devtools directly, so a production
   * import can be inspected without a bespoke tool.
   */
  serverTiming(): string;
}

export function stopwatch(): Stopwatch {
  const recorded: Phase[] = [];
  const started = performance.now();

  return {
    async phase(name, work, detail) {
      const from = performance.now();
      try {
        return await work();
      } finally {
        // In `finally` so a failed phase is still measured: an import that
        // times out is exactly the case where the breakdown matters most.
        recorded.push({ name, ms: Math.round(performance.now() - from), detail: detail?.() });
      }
    },
    record(name, ms, detail) {
      recorded.push({ name, ms: Math.round(ms), detail });
    },
    phases() {
      return [...recorded];
    },
    totalMs() {
      return Math.round(performance.now() - started);
    },
    serverTiming() {
      return recorded.map((p) => `${p.name.replace(/[^\w]/g, '_')};dur=${p.ms}`).join(', ');
    },
  };
}
