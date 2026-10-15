// Turning report rows into what the page draws. Pure, so it is tested
// without a browser or BigQuery.

import type { Row } from "./reports.ts";
import { FUNNEL_STEPS } from "./reports.ts";

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

export interface FunnelStep {
  label: string;
  users: number;
  ofStart: number;
  ofPrevious: number;
  medianMinutes: number | null;
}

/// Each step with its share of everyone who started and of the step before.
export function funnel(rows: Row[]): FunnelStep[] {
  const byStep = new Map(rows.map((r) => [String(r.step), r]));
  const start = n(byStep.get(FUNNEL_STEPS[0][0])?.users);
  let previous = start;
  return FUNNEL_STEPS.map(([step, label]) => {
    const row = byStep.get(step);
    const users = n(row?.users);
    const result = {
      label,
      users,
      ofStart: start > 0 ? users / start : 0,
      ofPrevious: previous > 0 ? users / previous : 0,
      medianMinutes: row?.median_minutes == null ? null : n(row.median_minutes),
    };
    previous = users;
    return result;
  });
}

/// The step that loses the largest share of those who reached the one
/// before it, ignoring the first.
export function biggestDrop(steps: FunnelStep[]): FunnelStep | null {
  let worst: FunnelStep | null = null;
  for (const step of steps.slice(1)) {
    if (!worst || step.ofPrevious < worst.ofPrevious) worst = step;
  }
  return worst;
}

export interface Cohort {
  cohort: string;
  size: number;
  /// Share of the cohort active in week 0, 1, 2…; null where that week has
  /// not happened yet.
  weeks: (number | null)[];
}

export function cohorts(rows: Row[], maxWeek = 8): Cohort[] {
  const map = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const key = String(r.cohort);
    if (!map.has(key)) map.set(key, new Map());
    map.get(key)!.set(n(r.week), n(r.users));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, weeks]) => {
      const size = weeks.get(0) ?? 0;
      const last = Math.max(...weeks.keys());
      return {
        cohort,
        size,
        weeks: Array.from({ length: maxWeek + 1 }, (_, w) =>
          w > last ? null : size > 0 ? (weeks.get(w) ?? 0) / size : 0,
        ),
      };
    });
}

/// Week-N retention averaged over the cohorts old enough to have one,
/// weighted by cohort size.
export function averageRetention(list: Cohort[], week: number): number | null {
  let users = 0;
  let size = 0;
  for (const c of list) {
    const share = c.weeks[week];
    if (share == null) continue;
    users += share * c.size;
    size += c.size;
  }
  return size > 0 ? users / size : null;
}

export const percent = (share: number | null, digits = 0) =>
  share == null ? "–" : `${(share * 100).toFixed(digits)}%`;

export function duration(minutes: number | null): string {
  if (minutes == null) return "–";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / (24 * 60))} days`;
}

export const share = (part: number, whole: number) => (whole > 0 ? part / whole : null);
export { n as num };
