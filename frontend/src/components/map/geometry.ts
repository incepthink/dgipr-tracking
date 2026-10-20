import raw from "@/data/maharashtra-geometry.json";

/**
 * Maharashtra's 36 districts, projected offline into the map's viewBox (ported from ai-newssharing; boundaries:
 * geoBoundaries ADM2, ODbL — see SOURCE.md). Names are not kept here: the app names a shape by its office
 * (offices.ts), so a rename is an edit in config/organisation.yaml only.
 */
export interface DistrictShape {
  id: string;
  d: string;
  centroid: [x: number, y: number];
  area: number;
}

export const MAP = {
  viewBox: raw.viewBox as string,
  size: raw.size as [number, number],
  landPath: raw.landPath as string,
  districts: (raw.districts as { id: string; d: string; centroid: number[]; area: number }[]).map((d) => ({
    id: d.id, d: d.d, centroid: d.centroid as [number, number], area: d.area,
  })) as DistrictShape[],
};

export const LEVELS = 5;

/**
 * District id → ramp step 1–5, by quantile over the districts that have a value. Quantiles, not equal-width bins:
 * the spread is uneven and equal bins paint most of the state the palest step. Missing values get no step;
 * "not reported" is drawn hatched, never as the bottom of the ramp. Ties share a step.
 */
export function heatLevels(values: Map<string, number | null>): Record<string, number> {
  const ranked = rankedOf(values);
  const out: Record<string, number> = {};
  if (!ranked.length) return out;
  for (const [k, v] of values) if (v !== null && v !== undefined && Number.isFinite(v)) out[k] = levelOf(v, ranked);
  return out;
}

/** The value range each step stands for, for the legend. */
export function heatBands(values: Map<string, number | null>): { level: number; min: number; max: number }[] {
  const ranked = rankedOf(values);
  const bands = new Map<number, { min: number; max: number }>();
  for (const v of ranked) {
    const l = levelOf(v, ranked);
    const b = bands.get(l);
    bands.set(l, { min: Math.min(b?.min ?? v, v), max: Math.max(b?.max ?? v, v) });
  }
  return [...bands.entries()].map(([level, b]) => ({ level, ...b })).sort((a, b) => a.level - b.level);
}

function rankedOf(values: Map<string, number | null>) {
  return [...values.values()].filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v)).sort((a, b) => a - b);
}

function levelOf(v: number, ranked: number[]) {
  const rank = ranked.indexOf(v);
  return Math.min(LEVELS, Math.floor((rank / ranked.length) * LEVELS) + 1);
}
