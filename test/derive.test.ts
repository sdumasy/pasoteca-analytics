import test from "node:test";
import assert from "node:assert";
import { funnel, biggestDrop, cohorts, averageRetention, duration, percent } from "../lib/derive.ts";
import { demoReport } from "../lib/demo.ts";
import { queriesFor, REPORT_NAMES, suffix, periodOf } from "../lib/reports.ts";
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
    const queries = queriesFor(name, { project: "p", gaDataset: "analytics_1", fsDataset: "fs" }, { from: "2026-09-15", to: "2026-10-15" });
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

test("only dancers with an account count: the funnel, the cohorts and the active dancers", () => {
  const config = { project: "p", gaDataset: "a", fsDataset: "f" };
  for (const q of [
    queriesFor("funnel", config, { from: "2026-10-01", to: "2026-10-15" }).steps,
    queriesFor("retention", config, { from: "2026-10-01", to: "2026-10-15" }).cohorts,
    queriesFor("weekly", config, { from: "2026-10-01", to: "2026-10-15" }).weeks,
  ]) {
    assert.match(q.sql, /loginTypes/);
    assert.match(q.sql, /user_id IN/);
  }
});

test("the cohort table is not named like its column", () => {
  const q = queriesFor("retention", { project: "p", gaDataset: "a", fsDataset: "f" }, { from: "2026-10-01", to: "2026-10-15" }).cohorts;
  assert.doesNotMatch(q.sql, /\bcohort AS \(/);
});

test("the period is put in order and kept to real days", () => {
  const fallback = { from: "2026-10-01", to: "2026-10-16" };
  assert.deepEqual(periodOf("2026-10-10", "2026-10-12", fallback), { from: "2026-10-10", to: "2026-10-12" });
  assert.deepEqual(periodOf("2026-10-12", "2026-10-10", fallback), { from: "2026-10-10", to: "2026-10-12" });
  assert.deepEqual(periodOf("yesterday", null, fallback), fallback);
});

test("every query is held to the period: Analytics by table day, app data by the day it was made", () => {
  for (const name of REPORT_NAMES) {
    for (const [section, q] of Object.entries(queriesFor(name, { project: "p", gaDataset: "a", fsDataset: "f" }, { from: "2026-10-01", to: "2026-10-15" }))) {
      if (name === "glance" || (name === "health" && section !== "events")) continue;
      if (/@from\b/.test(q.sql)) assert.equal(q.params?.from, "20261001", `${name}/${section}`);
      if (q.sql.includes("@fromDate")) assert.equal(q.params?.fromDate, "2026-10-01", `${name}/${section}`);
      assert.ok(/@from|@fromDate/.test(q.sql), `${name}/${section} ignores the period`);
    }
  }
});

test("test accounts are left out, and only well-formed addresses reach the SQL", () => {
  const q = queriesFor("glance", { project: "p", gaDataset: "a", fsDataset: "f", excluded: ["Playtest@pasoteca.com", "x' OR 1=1 --"] }, {
    from: "2026-10-01",
    to: "2026-10-15",
  }).totals;
  assert.match(q.sql, /NOT IN \('playtest@pasoteca.com'\)/);
  assert.doesNotMatch(q.sql, /OR 1=1/);
});
