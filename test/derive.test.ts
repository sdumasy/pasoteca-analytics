import test from "node:test";
import assert from "node:assert";
import { funnel, biggestDrop, cohorts, averageRetention, duration, percent } from "../lib/derive.ts";
import { demoReport } from "../lib/demo.ts";
import { queriesFor, REPORT_NAMES, suffix } from "../lib/reports.ts";
import { allowedEmails, mayView } from "../lib/access.ts";

test("the funnel gives each step its share of the start and of the step before", () => {
  const steps = funnel(demoReport("funnel").steps);
  assert.equal(steps[0].ofStart, 1);
  assert.equal(steps[1].users, 233);
  assert.ok(Math.abs(steps[2].ofPrevious - 151 / 233) < 1e-9);
});

test("the biggest drop is the step that keeps the smallest share", () => {
  const steps = funnel(demoReport("funnel").steps);
  assert.equal(biggestDrop(steps)?.label, "Started Pro");
});

test("a cohort's later weeks are blank until they have happened", () => {
  const list = cohorts(demoReport("retention").cohorts);
  const newest = list[list.length - 1];
  assert.equal(newest.weeks[0], 1);
  assert.equal(newest.weeks[1], null);
  assert.ok((averageRetention(list, 1) ?? 0) > 0.3);
});

test("waits and shares read as people say them", () => {
  assert.equal(duration(26), "26 min");
  assert.equal(duration(1440), "24 h");
  assert.equal(duration(4320), "3 days");
  assert.equal(percent(0.4567, 1), "45.7%");
  assert.equal(percent(null), "–");
});

test("every report has queries, and every query names the configured datasets", () => {
  for (const name of REPORT_NAMES) {
    const queries = queriesFor(name, { project: "p", gaDataset: "analytics_1", fsDataset: "fs" }, 30, new Date("2026-10-15T00:00:00Z"));
    assert.ok(Object.keys(queries).length > 0, name);
    for (const q of Object.values(queries)) assert.match(q.sql, /`p\.(analytics_1|fs)\./);
    // Demo data has the same sections, so the page draws both alike.
    assert.deepEqual(Object.keys(demoReport(name)).sort(), Object.keys(queries).sort(), name);
  }
});

test("the GA table range runs from days back to today", () => {
  assert.equal(suffix(new Date("2026-10-15T10:00:00Z"), 30), "20260915");
  assert.equal(suffix(new Date("2026-10-15T10:00:00Z"), 0), "20261015");
});

test("only a verified address on the list may see the numbers", () => {
  const allowed = allowedEmails(" Owner@Example.com , other@example.com");
  assert.ok(mayView({ email: "owner@example.com", email_verified: true }, allowed));
  assert.ok(!mayView({ email: "owner@example.com", email_verified: false }, allowed));
  assert.ok(!mayView({ email: "stranger@example.com", email_verified: true }, allowed));
  assert.ok(!mayView(null, allowed));
  assert.ok(!mayView({ email: "owner@example.com", email_verified: true }, allowedEmails("")));
});

test("a first visit on the web counts as opening the app", () => {
  const q = queriesFor("funnel", { project: "p", gaDataset: "a", fsDataset: "f" }, 30).steps;
  assert.match(q.sql, /first_visit/);
});

import { firstDay, sinceSuffix } from "../lib/reports.ts";

test("Analytics is read from the start date when it is later than the period", () => {
  const now = new Date(Date.UTC(2026, 9, 20));
  assert.equal(firstDay(now, 30, "20261016"), "20261016");
  assert.equal(firstDay(now, 2, "20261016"), "20261018");
  assert.equal(firstDay(now, 30, undefined), "20260920");
  assert.equal(sinceSuffix("2026-10-16"), "20261016");
  assert.equal(sinceSuffix("soon"), undefined);
});
