"use client";

// The few chart forms the questions need, drawn in plain HTML and SVG so
// each reads exactly as intended: stat tiles for single numbers, horizontal
// bars for steps and breakdowns, a cohort grid for retention, small
// multiples for weekly counts. One series a chart, so no chart needs a
// legend; every one has a hover readout and a table behind it.

import { useState, type ReactNode } from "react";
import type { Cohort, FunnelStep } from "@/lib/derive";
import { duration, percent } from "@/lib/derive";

export function Tiles({ items }: { items: { label: string; value: string; note?: string }[] }) {
  return (
    <div className="tiles">
      {items.map((item) => (
        <div className="tile" key={item.label}>
          <div className="tile-label">{item.label}</div>
          <div className="tile-value">{item.value}</div>
          {item.note ? <div className="tile-note">{item.note}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function Card({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {note ? <p className="card-note">{note}</p> : null}
      {children}
    </div>
  );
}

/// A readout that follows the pointer within its chart.
function useHover<T>() {
  const [hover, setHover] = useState<{ item: T; x: number; y: number } | null>(null);
  const bind = (item: T) => ({
    onMouseMove: (e: React.MouseEvent) => {
      const box = (e.currentTarget.closest(".chart") as HTMLElement).getBoundingClientRect();
      setHover({ item, x: e.clientX - box.left, y: e.clientY - box.top });
    },
    onMouseLeave: () => setHover(null),
    onFocus: (e: React.FocusEvent) => {
      const box = (e.currentTarget.closest(".chart") as HTMLElement).getBoundingClientRect();
      const own = e.currentTarget.getBoundingClientRect();
      setHover({ item, x: own.left - box.left + own.width / 2, y: own.top - box.top });
    },
    onBlur: () => setHover(null),
    tabIndex: 0,
  });
  return { hover, bind };
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="tooltip" style={{ left: x, top: y }} role="status">
      {children}
    </div>
  );
}

function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="table-view">
      <summary>Show as table</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/// The funnel as bars measured against everyone who started, with the share
/// kept from the step before beside each, the weakest step marked.
export function Funnel({ steps, weakest }: { steps: FunnelStep[]; weakest: string | null }) {
  const { hover, bind } = useHover<FunnelStep>();
  return (
    <div className="chart">
      <div className="bars">
        {steps.map((step, i) => (
          <div className="bar-row" key={step.label} {...bind(step)}>
            <div className="bar-label">{step.label}</div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${Math.max(step.ofStart * 100, step.users > 0 ? 0.6 : 0)}%` }} />
            </div>
            <div className="bar-value">
              <span className="num">{step.users.toLocaleString()}</span>
              {i > 0 ? (
                <span className={`step-share${step.label === weakest ? " weakest" : ""}`}>
                  {percent(step.ofPrevious)} kept
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {hover ? (
        <Tooltip x={hover.x} y={hover.y}>
          <strong>{hover.item.label}</strong>
          <div>
            {hover.item.users.toLocaleString()} dancers · {percent(hover.item.ofStart, 1)} of all who opened
          </div>
          <div>Median time from first open: {duration(hover.item.medianMinutes)}</div>
        </Tooltip>
      ) : null}
      <TableView
        head={["Step", "Dancers", "Of start", "Of step before", "Median time"]}
        rows={steps.map((s) => [s.label, s.users, percent(s.ofStart, 1), percent(s.ofPrevious, 1), duration(s.medianMinutes)])}
      />
    </div>
  );
}

/// Labelled horizontal bars for one measure across categories, or two
/// measures side by side when [secondUnit] is given: each row then has a
/// solid bar for the first and a lighter one beneath it for the second, on
/// one shared scale, with a key above.
export function Breakdown({
  rows,
  unit,
  secondUnit,
  format = (v) => v.toLocaleString(),
}: {
  rows: { label: string; value: number; second?: number; detail?: string }[];
  unit: string;
  secondUnit?: string;
  format?: (v: number) => string;
}) {
  const { hover, bind } = useHover<(typeof rows)[number]>();
  const paired = Boolean(secondUnit);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.second ?? 0)));
  if (rows.length === 0) return <p className="empty">Nothing recorded in this period yet.</p>;
  return (
    <div className="chart">
      {paired ? (
        <div className="key" aria-hidden="true">
          <span className="key-item"><span className="swatch" />{unit}</span>
          <span className="key-item"><span className="swatch second" />{secondUnit}</span>
        </div>
      ) : null}
      <div className="bars">
        {rows.map((row) => (
          <div className={`bar-row${paired ? " paired" : ""}`} key={row.label} {...bind(row)}>
            <div className="bar-label">{row.label}</div>
            <div className="bar-pair">
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(row.value / max) * 100}%` }} />
              </div>
              {paired ? (
                <div className="bar-track thin">
                  <div className="bar-fill second" style={{ width: `${((row.second ?? 0) / max) * 100}%` }} />
                </div>
              ) : null}
            </div>
            <div className="bar-value">
              <span className="num">{format(row.value)}</span>
              {paired ? <span className="step-share">{format(row.second ?? 0)}</span> : null}
            </div>
          </div>
        ))}
      </div>
      {hover ? (
        <Tooltip x={hover.x} y={hover.y}>
          <strong>{hover.item.label}</strong>
          <div>
            {format(hover.item.value)} {unit}
          </div>
          {paired ? (
            <div>
              {format(hover.item.second ?? 0)} {secondUnit}
            </div>
          ) : null}
          {hover.item.detail ? <div>{hover.item.detail}</div> : null}
        </Tooltip>
      ) : null}
      <TableView
        head={paired ? ["", unit, secondUnit!] : ["", unit]}
        rows={rows.map((r) => (paired ? [r.label, format(r.value), format(r.second ?? 0)] : [r.label, format(r.value)]))}
      />
    </div>
  );
}

/// Weekly cohorts down, weeks since joining across; each cell the share of
/// the cohort still active, darker teal for more.
export function CohortGrid({ list }: { list: Cohort[] }) {
  const { hover, bind } = useHover<{ cohort: Cohort; week: number }>();
  const weeks = list[0]?.weeks.length ?? 0;
  if (list.length === 0) return <p className="empty">No dancers seen in this period yet.</p>;
  return (
    <div className="chart">
      <div className="table-scroll">
        <table className="cohorts">
          <thead>
            <tr>
              <th>Joined week of</th>
              <th>Dancers</th>
              {Array.from({ length: weeks }, (_, w) => (
                <th key={w}>W{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((cohort) => (
              <tr key={cohort.cohort}>
                <td className="cohort-name">{formatWeek(cohort.cohort)}</td>
                <td className="num">{cohort.size}</td>
                {cohort.weeks.map((share, w) =>
                  share == null ? (
                    <td key={w} className="cell cell-future" aria-label="not yet" />
                  ) : (
                    <td
                      key={w}
                      className={`cell${share >= 0.5 ? " cell-dark" : ""}`}
                      style={{ ["--level" as string]: `${Math.round(Math.min(1, share) * 100)}%` }}
                      {...bind({ cohort, week: w })}
                    >
                      {percent(share)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hover ? (
        <Tooltip x={hover.x} y={hover.y}>
          <strong>Joined week of {formatWeek(hover.item.cohort.cohort)}</strong>
          <div>
            Week {hover.item.week}: {percent(hover.item.cohort.weeks[hover.item.week], 1)} of{" "}
            {hover.item.cohort.size} still active
          </div>
        </Tooltip>
      ) : null}
    </div>
  );
}

/// One small bar chart per measure, sharing the weeks along the bottom but
/// each with its own scale, so no two measures share an axis.
export function WeeklyMultiples({
  weeks,
  measures,
}: {
  weeks: { week: string; values: Record<string, number> }[];
  measures: { key: string; label: string }[];
}) {
  return (
    <div className="multiples">
      {measures.map((m) => (
        <WeeklyBars key={m.key} label={m.label} points={weeks.map((w) => ({ week: w.week, value: w.values[m.key] ?? 0 }))} />
      ))}
    </div>
  );
}

function WeeklyBars({ label, points }: { label: string; points: { week: string; value: number }[] }) {
  const { hover, bind } = useHover<{ week: string; value: number }>();
  const max = Math.max(1, ...points.map((p) => p.value));
  const last = points[points.length - 1];
  return (
    <div className="chart small">
      <div className="small-head">
        <span>{label}</span>
        <span className="num">{last ? last.value.toLocaleString() : "–"}</span>
      </div>
      <div className="columns">
        {points.map((p, i) => (
          <div className="column-hit" key={p.week} {...bind(p)}>
            <div className={`column${i === points.length - 1 ? " current" : ""}`} style={{ height: `${(p.value / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="columns-axis">
        <span>{points[0] ? formatWeek(points[0].week) : ""}</span>
        <span>{last ? formatWeek(last.week) : ""}</span>
      </div>
      {hover ? (
        <Tooltip x={hover.x} y={hover.y}>
          <strong>Week of {formatWeek(hover.item.week)}</strong>
          <div>
            {hover.item.value.toLocaleString()} {label.toLowerCase()}
          </div>
        </Tooltip>
      ) : null}
    </div>
  );
}

/// A line of points over weeks on one axis, for a single average.
export function TrendLine({
  points,
  label,
  min,
  max,
}: {
  points: { x: number; y: number; n: number }[];
  label: string;
  min: number;
  max: number;
}) {
  const { hover, bind } = useHover<{ x: number; y: number; n: number }>();
  const W = 600;
  const H = 180;
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  if (points.length === 0) return <p className="empty">No rated moves yet.</p>;
  const xMax = Math.max(1, ...points.map((p) => p.x));
  const sx = (x: number) => pad.l + (x / xMax) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - min) / (max - min)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const ticks = [min, (min + max) / 2, max];
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={pad.l - 6} y={sy(t) + 4} className="axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <path d={path} className="trend-line" fill="none" />
        {points.map((p) => (
          <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r={4} className="trend-dot" {...bind(p)} />
        ))}
        <text x={pad.l} y={H - 6} className="axis">
          new
        </text>
        <text x={W - pad.r} y={H - 6} className="axis" textAnchor="end">
          {xMax} weeks old
        </text>
      </svg>
      {hover ? (
        <Tooltip x={hover.x} y={hover.y}>
          <strong>{hover.item.x === 0 ? "Cut this week" : `${hover.item.x} weeks old`}</strong>
          <div>
            Average {hover.item.y.toFixed(1)} over {hover.item.n} moves
          </div>
        </Tooltip>
      ) : null}
      <TableView head={["Weeks old", "Average rating", "Moves"]} rows={points.map((p) => [p.x, p.y.toFixed(2), p.n])} />
    </div>
  );
}

export function formatWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
