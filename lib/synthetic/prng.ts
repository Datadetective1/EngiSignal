/**
 * Deterministic pseudo-random number generation for synthetic demo data.
 *
 * Every value in the demo organization derives from a fixed seed, so the same
 * dataset is produced on every machine, in every environment, forever. That
 * matters for more than tidiness: the demo is used to demonstrate specific
 * financial figures, and those figures must not drift between sessions.
 */

/** Hash a string seed into a 32-bit integer. */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, and well-distributed for non-cryptographic use. */
export function createRng(seed: string | number): Rng {
  let state = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Uniform float in [min, max). */
    float: (min: number, max: number) => min + next() * (max - min),
    /** Uniform integer in [min, max] inclusive. */
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    /** True with the given probability. */
    chance: (probability: number) => next() < probability,
    /** Pick one element. Returns undefined only for an empty array. */
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
    /**
     * Weighted pick. Weights need not sum to 1.
     */
    weighted: <T>(items: readonly { value: T; weight: number }[]): T => {
      let total = 0;
      for (const item of items) total += item.weight;
      let roll = next() * total;
      for (const item of items) {
        roll -= item.weight;
        if (roll <= 0) return item.value;
      }
      return (items[items.length - 1] as { value: T; weight: number }).value;
    },
    /** Approximately normal via the central limit theorem. */
    normal: (mean: number, stdDev: number) => {
      const u = next() + next() + next() + next() + next() + next() - 3;
      return mean + u * stdDev * 0.7071;
    },
    /** Fisher–Yates shuffle. Returns a new array. */
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = out[i] as T;
        const b = out[j] as T;
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
  };
}

export interface Rng {
  next(): number;
  float(min: number, max: number): number;
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly { value: T; weight: number }[]): T;
  normal(mean: number, stdDev: number): number;
  shuffle<T>(items: readonly T[]): T[];
}
