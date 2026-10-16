// Made-up numbers in the shape of every report, for running the dashboard
// without BigQuery behind it (DEMO=1) and for its tests. The page says
// plainly when it is showing these.

import type { ReportName, Row } from "./reports.ts";
import { FUNNEL_STEPS } from "./reports.ts";

const weeksBack = (n: number) => {
  const d = new Date(Date.UTC(2026, 9, 12 - 7 * n));
  return d.toISOString().slice(0, 10);
};

export function demoReport(name: ReportName): Record<string, Row[]> {
  switch (name) {
    case "glance":
      return { totals: [{ users: 118, classes: 690, moves: 1880 }], lastWeek: [{ active: 41 }] };
    case "health":
      return {
        ga: [{ tables: 34, first_day: "20260913", last_day: "20261015", events: 48210, updated: "2026-10-16 06:12" }],
        events: [
          { event_name: "screen_view", events: 21004, users: 388 },
          { event_name: "first_open", events: 412, users: 412 },
          { event_name: "class_created", events: 690, users: 233 },
          { event_name: "move_clipped", events: 1880, users: 151 },
        ],
        firestore: [
          { collection: "classes", docs: 690, updated: "2026-10-16 03:16" },
          { collection: "moves", docs: 1880, updated: "2026-10-16 03:16" },
          { collection: "users", docs: 412, updated: "2026-10-16 03:16" },
        ],
      };
    case "funnel": {
      const users = [412, 233, 151, 118, 84, 39, 11];
      const minutes = [0, 9, 26, 1440, 1460, 2880, 4320];
      return {
        steps: FUNNEL_STEPS.map(([step], pos) => ({ step, pos, users: users[pos], median_minutes: minutes[pos] })),
        guests: [
          { from_guest: "true", method: "apple", users: 54 },
          { from_guest: "true", method: "google", users: 31 },
          { from_guest: "false", method: "email", users: 21 },
          { from_guest: "true", method: "email", users: 12 },
        ],
      };
    }
    case "retention": {
      const rows: Row[] = [];
      const sizes = [61, 74, 58, 92, 80, 67, 88, 71];
      sizes.forEach((size, i) => {
        const cohort = weeksBack(sizes.length - 1 - i);
        const maxWeek = sizes.length - 1 - i;
        for (let week = 0; week <= Math.min(8, maxWeek); week++) {
          const share = week === 0 ? 1 : Math.max(0.12, 0.46 * Math.pow(0.86, week - 1) + (i % 3) * 0.02);
          rows.push({ cohort, week, users: Math.round(size * share) });
        }
      });
      return { cohorts: rows };
    }
    case "weekly":
      return {
        weeks: Array.from({ length: 12 }, (_, i) => ({
          week: weeksBack(11 - i),
          active_users: 120 + i * 14 + (i % 4) * 9,
          classes: 60 + i * 7 + (i % 3) * 5,
          moves: 210 + i * 26 + (i % 2) * 18,
          sessions: 70 + i * 11 - (i % 5) * 6,
        })),
      };
    case "loop":
      return {
        movesPerClass: [
          { bucket: "0", sort: 0, classes: 96 },
          { bucket: "1", sort: 1, classes: 41 },
          { bucket: "2", sort: 2, classes: 63 },
          { bucket: "3", sort: 3, classes: 88 },
          { bucket: "4", sort: 4, classes: 70 },
          { bucket: "5–9", sort: 5, classes: 52 },
          { bucket: "10+", sort: 10, classes: 9 },
        ],
        timeToClip: [{ median_hours: 19, same_day: 214, clipped_classes: 323 }],
        masteryByAge: Array.from({ length: 13 }, (_, w) => ({
          weeks_old: w,
          avg_mastery: Math.round((3.1 + 2.2 * (1 - Math.exp(-w / 4))) * 100) / 100,
          moves: Math.max(12, 160 - w * 11),
        })),
        totals: [{ accounts: 388, classes: 419, moves: 1406, sessions: 612, rated_moves: 1121 }],
      };
    case "styles":
      return {
        danceStyles: [
          { name: "Bachata", classes: 214, dancers: 61 },
          { name: "Salsa", classes: 133, dancers: 42 },
          { name: "Kizomba", classes: 38, dancers: 14 },
          { name: "Zouk", classes: 21, dancers: 6 },
        ],
        schools: [
          { name: "Extremos", classes: 96, dancers: 23 },
          { name: "DanceFree", classes: 71, dancers: 19 },
          { name: "Nueva Guardia", classes: 44, dancers: 12 },
          { name: "EPA Dance Studio", classes: 30, dancers: 9 },
        ],
        instructors: [
          { name: "Jeremy & Linsey", classes: 58, dancers: 17 },
          { name: "Diego & Yasmin", classes: 41, dancers: 13 },
          { name: "Dani & Adel", classes: 33, dancers: 11 },
        ],
      };
    case "ideas":
      return {
        top: [
          { title: "Slow-motion playback for clips", status: "planned", votes: 34, posted: "2026-09-02" },
          { title: "Share a whole practice session", status: "open", votes: 21, posted: "2026-09-18" },
          { title: "Count-in beat before each move", status: "open", votes: 17, posted: "2026-09-25" },
          { title: "Dark mode for the clipper", status: "done", votes: 9, posted: "2026-08-14" },
        ],
      };
    case "friction":
      return {
        clipper: [
          { saved: "true", visits: 402, avg_clips: 3.4 },
          { saved: "false", visits: 131, avg_clips: 0.6 },
        ],
        downloads: [{ downloads: 188, failed: 7, p50_seconds: 14, p90_seconds: 51, avg_megabytes: 92 }],
        videoSources: [
          { source: "library", videos: 244 },
          { source: "camera", videos: 131 },
          { source: "files", videos: 38 },
        ],
        startedVsDone: [{ started_class: 287, created_class: 233, started_clipping: 198, clipped: 151 }],
      };
    case "sharing":
      return {
        sent: [
          { kind: "move", via: "username", shares: 96 },
          { kind: "move", via: "link", shares: 71 },
          { kind: "class", via: "link", shares: 24 },
          { kind: "class", via: "username", shares: 17 },
        ],
        opened: [
          { via: "username", signed_in: "true", opens: 101 },
          { via: "link", signed_in: "false", opens: 58 },
          { via: "link", signed_in: "true", opens: 33 },
        ],
        inbox: [
          { status: "accepted", kind: "move", shares: 78 },
          { status: "pending", kind: "move", shares: 12 },
          { status: "skipped", kind: "move", shares: 6 },
          { status: "accepted", kind: "class", shares: 14 },
          { status: "pending", kind: "class", shares: 3 },
        ],
        push: [
          { granted: "true", users: 92 },
          { granted: "false", users: 37 },
        ],
      };
    case "money":
      return {
        paywall: [
          { reason: "moves", viewers: 61, started_pro: 9 },
          { reason: "classes", viewers: 34, started_pro: 4 },
          { reason: "profile", viewers: 22, started_pro: 2 },
        ],
        plans: [
          { plan: "annual", with_trial: "true", starts: 9 },
          { plan: "monthly", with_trial: "false", starts: 5 },
          { plan: "annual", with_trial: "false", starts: 1 },
        ],
      };
  }
}
