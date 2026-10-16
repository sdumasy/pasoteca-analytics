// The questions the dashboard answers, each as one or more SQL queries over
// two BigQuery datasets in the app's project:
//
//   - Google Analytics' own daily export (`analytics_<property id>`): what
//     dancers did, event by event.
//   - `firestore_export`, written nightly by the app's Cloud Function: what
//     they made (classes, moves, sessions, shares), one JSON row a document.
//
// Every query returns plain rows; the page decides how to draw them.

export type Row = Record<string, string | number | null>;

export interface ReportConfig {
  project: string;
  gaDataset: string;
  fsDataset: string;
}

/// The days a report covers, both included, as `YYYY-MM-DD`.
export interface Period {
  from: string;
  to: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/// A period from the page's `from` and `to`, put in order and kept to real
/// days; [fallback] for whatever is missing or malformed.
export function periodOf(from: string | null, to: string | null, fallback: Period): Period {
  const a = from && DAY.test(from) ? from : fallback.from;
  const b = to && DAY.test(to) ? to : fallback.to;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/// `YYYY-MM-DD`, [daysBack] days before [now] (UTC).
export function dayBefore(now: Date, daysBack: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack)).toISOString().slice(0, 10);
}

export interface Query {
  sql: string;
  params?: Record<string, unknown>;
}

export const REPORT_NAMES = ["health", "funnel", "retention", "weekly", "loop", "styles", "friction", "sharing", "money", "ideas"] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

export function isReportName(name: string): name is ReportName {
  return (REPORT_NAMES as readonly string[]).includes(name);
}

/// The steps of the first-week funnel, in order, with what the page calls them.
export const FUNNEL_STEPS: ReadonlyArray<[event: string, label: string]> = [
  ["sign_up", "Made an account"],
  ["class_created", "Logged a class"],
  ["move_clipped", "Cut a move"],
  ["session_started", "Started practising"],
  ["session_completed", "Finished a session"],
  ["paywall_viewed", "Saw the paywall"],
  ["pro_started", "Started Pro"],
];

/// `YYYYMMDD` for the GA tables' suffix, [days] back from [now].
export function suffix(now: Date, daysBack: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack));
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

const str = (key: string) => `(SELECT value.string_value FROM UNNEST(event_params) WHERE key = '${key}')`;
const int = (key: string) => `(SELECT value.int_value FROM UNNEST(event_params) WHERE key = '${key}')`;

/// The queries behind [name], keyed by the section of the page they fill.
export function queriesFor(name: ReportName, config: ReportConfig, period: Period): Record<string, Query> {
  const events = `\`${config.project}.${config.gaDataset}.events_*\``;
  const fs = (table: string) => `\`${config.project}.${config.fsDataset}.${table}\``;
  // Analytics tables by their day suffix; the app's own documents by the
  // day they were made. Both ends included.
  const range = { from: period.from.replaceAll("-", ""), to: period.to.replaceAll("-", "") };
  const dates = { fromDate: period.from, toDate: period.to };
  const made = (alias = "") =>
    `DATE(TIMESTAMP(JSON_VALUE(${alias ? `${alias}.` : ""}data, '$.createdAt'))) BETWEEN DATE(@fromDate) AND DATE(@toDate)`;
  const inRange = `_TABLE_SUFFIX BETWEEN @from AND @to`;
  // Dancers with a real account (email, Google or Apple), by their uid,
  // which is also the Analytics user_id. Guests, Play's test bots and anyone
  // who opened the app and left are not dancers yet. The uid stays the same
  // when a guest signs up, so what they did as a guest still counts.
  const accounts = `(SELECT id FROM ${fs("users")} WHERE ARRAY_LENGTH(IFNULL(JSON_QUERY_ARRAY(data, '$.loginTypes'), [])) > 0)`;

  switch (name) {
    case "health":
      return {
        // Whether Google Analytics' export exists, how far it reaches and
        // when it last grew: an empty page is either no dancers or no data.
        ga: {
          sql: `
            SELECT COUNT(*) AS tables,
              MIN(REGEXP_EXTRACT(table_id, r'(\\d{8})$')) AS first_day,
              MAX(REGEXP_EXTRACT(table_id, r'(\\d{8})$')) AS last_day,
              SUM(row_count) AS events,
              FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', TIMESTAMP_MILLIS(MAX(last_modified_time)), 'Europe/Amsterdam') AS updated
            FROM \`${config.project}.${config.gaDataset}.__TABLES__\`
            WHERE STARTS_WITH(table_id, 'events_')`,
        },
        // What the app actually sent in the period, by event.
        events: {
          sql: `
            SELECT event_name, COUNT(*) AS events, COUNT(DISTINCT user_pseudo_id) AS users
            FROM ${events} WHERE ${inRange}
            GROUP BY event_name ORDER BY events DESC LIMIT 25`,
          params: range,
        },
        // The nightly copy of the app's own data, table by table.
        firestore: {
          sql: `
            SELECT table_id AS collection, row_count AS docs,
              FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', TIMESTAMP_MILLIS(last_modified_time), 'Europe/Amsterdam') AS updated
            FROM ${fs("__TABLES__")} ORDER BY table_id`,
        },
      };

    case "funnel":
      return {
        steps: {
          // Dancers who made an account in the window, and how many of them
          // reached each step (before or after signing up), with the median
          // time from their first event.
          sql: `
            WITH ev AS (
              SELECT user_id AS u, event_name AS n, TIMESTAMP_MICROS(event_timestamp) AS t
              FROM ${events} WHERE ${inRange} AND user_id IN ${accounts}
            ),
            newcomers AS (
              SELECT u, MIN(t) AS first_t FROM ev
              WHERE u IN (SELECT u FROM ev WHERE n = 'sign_up') GROUP BY u
            ),
            firsts AS (
              SELECT n, u, MIN(t) AS t FROM ev JOIN newcomers USING (u) GROUP BY n, u
            )
            SELECT step, pos,
              COUNT(DISTINCT f.u) AS users,
              APPROX_QUANTILES(TIMESTAMP_DIFF(f.t, nc.first_t, MINUTE), 100)[SAFE_OFFSET(50)] AS median_minutes
            FROM UNNEST(@steps) AS step WITH OFFSET AS pos
            LEFT JOIN firsts f ON f.n = step
            LEFT JOIN newcomers nc ON nc.u = f.u
            GROUP BY step, pos
            ORDER BY pos`,
          params: { ...range, steps: FUNNEL_STEPS.map(([event]) => event) },
        },
        guests: {
          // Of the new accounts, how many began as a guest.
          sql: `
            SELECT ${str("from_guest")} AS from_guest, ${str("method")} AS method, COUNT(DISTINCT user_pseudo_id) AS users
            FROM ${events} WHERE ${inRange} AND event_name = 'sign_up'
            GROUP BY from_guest, method ORDER BY users DESC`,
          params: range,
        },
      };

    case "retention":
      return {
        cohorts: {
          // Weekly cohorts by the first week a dancer was seen, and how many
          // of each were back in each following week.
          sql: `
            WITH ev AS (
              SELECT DISTINCT user_id AS u, DATE_TRUNC(PARSE_DATE('%Y%m%d', event_date), WEEK(MONDAY)) AS w
              FROM ${events} WHERE ${inRange} AND user_id IN ${accounts}
            ),
            -- Named apart from its column: a table called cohort made
            -- "cohort" the whole row, and DATE_DIFF refused it.
            firsts AS (SELECT u, MIN(w) AS first_week FROM ev GROUP BY u)
            SELECT FORMAT_DATE('%Y-%m-%d', first_week) AS cohort, DATE_DIFF(w, first_week, WEEK) AS week, COUNT(DISTINCT u) AS users
            FROM ev JOIN firsts USING (u)
            WHERE DATE_DIFF(w, first_week, WEEK) BETWEEN 0 AND 8
            GROUP BY first_week, week ORDER BY first_week, week`,
          params: range,
        },
      };

    case "weekly":
      return {
        weeks: {
          sql: `
            SELECT FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(PARSE_DATE('%Y%m%d', event_date), WEEK(MONDAY))) AS week,
              COUNT(DISTINCT IF(user_id IN ${accounts}, user_id, NULL)) AS active_users,
              COUNTIF(event_name = 'class_created' AND ${str("is_edit")} = 'false') AS classes,
              COUNTIF(event_name = 'move_clipped' AND ${str("is_edit")} = 'false') AS moves,
              COUNTIF(event_name = 'session_completed') AS sessions
            FROM ${events} WHERE ${inRange}
            GROUP BY week ORDER BY week`,
          params: range,
        },
      };

    case "loop":
      return {
        movesPerClass: {
          // How many moves each class was cut into: a class with none is a
          // video the dancer filmed and never came back to.
          sql: `
            WITH per_class AS (
              SELECT c.id, COUNT(m.id) AS moves
              FROM ${fs("classes")} c
              LEFT JOIN ${fs("moves")} m ON JSON_VALUE(m.data, '$.classId') = c.id
              WHERE ${made("c")}
              GROUP BY c.id
            )
            SELECT CASE WHEN moves >= 10 THEN '10+' WHEN moves >= 5 THEN '5–9' ELSE CAST(moves AS STRING) END AS bucket,
              MIN(moves) AS sort, COUNT(*) AS classes
            FROM per_class GROUP BY bucket ORDER BY sort`,
          params: dates,
        },
        timeToClip: {
          // Days from logging a class to cutting its first move.
          sql: `
            WITH firsts AS (
              SELECT c.id,
                TIMESTAMP(JSON_VALUE(c.data, '$.createdAt')) AS logged,
                MIN(TIMESTAMP(JSON_VALUE(m.data, '$.createdAt'))) AS clipped
              FROM ${fs("classes")} c JOIN ${fs("moves")} m ON JSON_VALUE(m.data, '$.classId') = c.id
              WHERE ${made("c")}
              GROUP BY c.id, logged
            )
            SELECT
              APPROX_QUANTILES(TIMESTAMP_DIFF(clipped, logged, HOUR), 100)[SAFE_OFFSET(50)] AS median_hours,
              COUNTIF(TIMESTAMP_DIFF(clipped, logged, HOUR) < 24) AS same_day,
              COUNT(*) AS clipped_classes
            FROM firsts WHERE logged IS NOT NULL AND clipped IS NOT NULL`,
          params: dates,
        },
        masteryByAge: {
          // The average rating of moves by how long ago they were cut: rising
          // with age means practice works.
          sql: `
            SELECT DATE_DIFF(CURRENT_DATE(), DATE(TIMESTAMP(JSON_VALUE(data, '$.createdAt'))), WEEK) AS weeks_old,
              ROUND(AVG(SAFE_CAST(JSON_VALUE(data, '$.masteryUser') AS FLOAT64)), 2) AS avg_mastery,
              COUNT(*) AS moves
            FROM ${fs("moves")}
            WHERE JSON_VALUE(data, '$.createdAt') IS NOT NULL AND ${made()}
              AND SAFE_CAST(JSON_VALUE(data, '$.masteryUser') AS FLOAT64) > 0
            GROUP BY weeks_old HAVING weeks_old <= 12 ORDER BY weeks_old`,
          params: dates,
        },
        totals: {
          sql: `
            SELECT
              (SELECT COUNT(*) FROM ${fs("users")} WHERE id IN ${accounts}) AS accounts,
              (SELECT COUNT(*) FROM ${fs("classes")} WHERE ${made()}) AS classes,
              (SELECT COUNT(*) FROM ${fs("moves")} WHERE ${made()}) AS moves,
              (SELECT COUNT(*) FROM ${fs("practice_sessions")} WHERE ${made()}) AS sessions,
              (SELECT COUNTIF(SAFE_CAST(JSON_VALUE(data, '$.masteryUser') AS INT64) > 0) FROM ${fs("moves")} WHERE ${made()}) AS rated_moves`,
          params: dates,
        },
      };

    case "styles": {
      // Classes and the dancers behind them, by a field of the class. Names
      // are compared trimmed and case-blind, so "Bachata " and "bachata"
      // are one style.
      const by = (field: string) => ({
        sql: `
          SELECT ANY_VALUE(TRIM(JSON_VALUE(data, '$.${field}'))) AS name,
            COUNT(*) AS classes,
            COUNT(DISTINCT JSON_VALUE(data, '$.userId')) AS dancers
          FROM ${fs("classes")}
          WHERE TRIM(IFNULL(JSON_VALUE(data, '$.${field}'), '')) != '' AND ${made()}
          GROUP BY LOWER(TRIM(JSON_VALUE(data, '$.${field}')))
          ORDER BY dancers DESC, classes DESC
          LIMIT 12`,
        params: dates,
      });
      return { danceStyles: by("danceStyle"), schools: by("school"), instructors: by("instructor") };
    }

    case "ideas":
      return {
        top: {
          // The ideas board, most wanted first. Only the idea itself: who
          // posted it is left out of the copy.
          sql: `
            SELECT JSON_VALUE(data, '$.title') AS title,
              IFNULL(JSON_VALUE(data, '$.status'), 'open') AS status,
              IFNULL(SAFE_CAST(JSON_VALUE(data, '$.voteCount') AS INT64), 0) AS votes,
              FORMAT_TIMESTAMP('%Y-%m-%d', TIMESTAMP(JSON_VALUE(data, '$.createdAt'))) AS posted
            FROM ${fs("ideas")}
            WHERE JSON_VALUE(data, '$.title') IS NOT NULL AND ${made()}
            ORDER BY votes DESC, posted DESC
            LIMIT 20`,
          params: dates,
        },
      };

    case "friction":
      return {
        clipper: {
          // Clippers left with cuts unsaved, against clippers whose cuts were kept.
          sql: `
            SELECT ${str("saved")} AS saved, COUNT(*) AS visits, ROUND(AVG(${int("clips")}), 1) AS avg_clips
            FROM ${events} WHERE ${inRange} AND event_name = 'clipper_closed'
            GROUP BY saved`,
          params: range,
        },
        downloads: {
          sql: `
            SELECT
              COUNT(*) AS downloads,
              COUNTIF(${str("ok")} = 'false') AS failed,
              APPROX_QUANTILES(${int("seconds")}, 100)[SAFE_OFFSET(50)] AS p50_seconds,
              APPROX_QUANTILES(${int("seconds")}, 100)[SAFE_OFFSET(90)] AS p90_seconds,
              ROUND(AVG(${int("megabytes")})) AS avg_megabytes
            FROM ${events} WHERE ${inRange} AND event_name = 'class_video_downloaded'`,
          params: range,
        },
        videoSources: {
          sql: `
            SELECT ${str("source")} AS source, COUNT(*) AS videos
            FROM ${events} WHERE ${inRange} AND event_name = 'video_picked'
            GROUP BY source ORDER BY videos DESC`,
          params: range,
        },
        startedVsDone: {
          // Dancers who set out to record or clip, against those who finished.
          sql: `
            SELECT
              COUNT(DISTINCT IF(event_name = 'class_recording_started', user_pseudo_id, NULL)) AS started_class,
              COUNT(DISTINCT IF(event_name = 'class_created', user_pseudo_id, NULL)) AS created_class,
              COUNT(DISTINCT IF(event_name = 'move_clipping_started', user_pseudo_id, NULL)) AS started_clipping,
              COUNT(DISTINCT IF(event_name = 'move_clipped', user_pseudo_id, NULL)) AS clipped
            FROM ${events} WHERE ${inRange}`,
          params: range,
        },
      };

    case "sharing":
      return {
        sent: {
          sql: `
            SELECT ${str("kind")} AS kind, ${str("via")} AS via, COUNT(*) AS shares
            FROM ${events} WHERE ${inRange} AND event_name = 'share_sent'
            GROUP BY kind, via ORDER BY shares DESC`,
          params: range,
        },
        opened: {
          sql: `
            SELECT ${str("via")} AS via, ${str("signed_in")} AS signed_in, COUNT(*) AS opens
            FROM ${events} WHERE ${inRange} AND event_name = 'share_opened'
            GROUP BY via, signed_in ORDER BY opens DESC`,
          params: range,
        },
        inbox: {
          // Shares by username, by what became of them.
          sql: `
            SELECT IFNULL(JSON_VALUE(data, '$.status'), 'pending') AS status,
              IF(JSON_QUERY(data, '$.classSnapshot') IS NOT NULL, 'class', 'move') AS kind,
              COUNT(*) AS shares
            FROM ${fs("move_shares")} WHERE ${made()} GROUP BY status, kind ORDER BY shares DESC`,
          params: dates,
        },
        push: {
          sql: `
            SELECT ${str("granted")} AS granted, COUNT(DISTINCT user_pseudo_id) AS users
            FROM ${events} WHERE ${inRange} AND event_name = 'push_permission'
            GROUP BY granted`,
          params: range,
        },
      };

    case "money":
      return {
        paywall: {
          // Who saw the paywall, by what brought it up, and how many of them
          // started Pro within a week of seeing it.
          sql: `
            WITH views AS (
              SELECT user_pseudo_id AS u, ${str("reason")} AS reason, MIN(TIMESTAMP_MICROS(event_timestamp)) AS t
              FROM ${events} WHERE ${inRange} AND event_name = 'paywall_viewed' GROUP BY u, reason
            ),
            pro AS (
              SELECT user_pseudo_id AS u, MIN(TIMESTAMP_MICROS(event_timestamp)) AS t
              FROM ${events} WHERE ${inRange} AND event_name = 'pro_started' GROUP BY u
            )
            SELECT reason, COUNT(DISTINCT v.u) AS viewers,
              COUNT(DISTINCT IF(p.t BETWEEN v.t AND TIMESTAMP_ADD(v.t, INTERVAL 7 DAY), v.u, NULL)) AS started_pro
            FROM views v LEFT JOIN pro p USING (u)
            GROUP BY reason ORDER BY viewers DESC`,
          params: range,
        },
        plans: {
          sql: `
            SELECT ${str("plan")} AS plan, ${str("with_trial")} AS with_trial, COUNT(*) AS starts
            FROM ${events} WHERE ${inRange} AND event_name = 'pro_started'
            GROUP BY plan, with_trial ORDER BY starts DESC`,
          params: range,
        },
      };
  }
}
