"use client";

import { useCallback, useEffect, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { Breakdown, Card, CohortGrid, Funnel, Tiles, TrendLine, WeeklyMultiples } from "@/components/charts";
import { averageRetention, biggestDrop, cohorts, duration, funnel, num, percent, share } from "@/lib/derive";
import type { Period, ReportName, Row } from "@/lib/reports";

const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function auth() {
  if (getApps().length === 0) initializeApp(firebaseConfig);
  return getAuth();
}

type Sections = Record<string, Row[]>;
interface Report {
  demo: boolean;
  sections: Sections;
  errors?: Record<string, string>;
  /// The days the answer covers.
  period?: Period;
}

const QUESTIONS: { id: ReportName; title: string }[] = [
  { id: "glance", title: "At a glance" },
  { id: "health", title: "Is the data coming in?" },
  { id: "funnel", title: "Do new dancers get to their first move?" },
  { id: "retention", title: "Do they come back?" },
  { id: "weekly", title: "How busy is the app, week to week?" },
  { id: "loop", title: "Is the class → moves → practice loop working?" },
  { id: "styles", title: "Which styles, schools and teachers?" },
  { id: "friction", title: "Where does it get in the way?" },
  { id: "sharing", title: "Does sharing bring dancers in?" },
  { id: "money", title: "Does the paywall convert?" },
  { id: "ideas", title: "What do dancers ask for?" },
];

const PRESETS = [7, 30, 90] as const;

/// The first day the slider reaches back to: the app's first users.
const FIRST_DAY = "2026-09-01";
/// Where the page starts: the day real use began (see COUNT_FROM on the
/// server), or the last 30 days before that day has come.
const COUNT_FROM = "2026-10-17";

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
const startPeriod = (): Period => {
  const t = today();
  return { from: COUNT_FROM <= t ? COUNT_FROM : addDays(t, -30), to: t };
};
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/// Start and end of the period every question answers for: two dates, a
/// slider between them, and the usual "last N days". Changes settle for a
/// moment before the page asks again, so dragging does not fire a query a
/// step.
function PeriodBar({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const [draft, setDraft] = useState(period);
  useEffect(() => setDraft(period), [period]);
  useEffect(() => {
    if (draft.from === period.from && draft.to === period.to) return;
    const timer = setTimeout(() => onChange(draft), 450);
    return () => clearTimeout(timer);
  }, [draft, period, onChange]);

  const last = today();
  const span = Math.max(1, daysBetween(FIRST_DAY, last));
  const a = Math.max(0, daysBetween(FIRST_DAY, draft.from));
  const b = Math.max(0, daysBetween(FIRST_DAY, draft.to));
  const preset = PRESETS.find((n) => draft.to === last && draft.from === addDays(last, -n + 1));
  return (
    <div className="period">
      <div className="period-dates">
        <label>
          <span className="tile-label">From</span>
          <input
            type="date"
            min={FIRST_DAY}
            max={draft.to}
            value={draft.from}
            onChange={(e) => e.target.value && setDraft((d) => ({ ...d, from: e.target.value }))}
          />
        </label>
        <div
          className="dual"
          style={{ ["--a" as string]: `${(a / span) * 100}%`, ["--b" as string]: `${(b / span) * 100}%` }}
        >
          <div className="dual-track" aria-hidden="true">
            <div className="dual-fill" />
          </div>
          <input
            type="range"
            min={0}
            max={span}
            value={a}
            aria-label="Start of the period"
            aria-valuetext={shortDay(draft.from)}
            onChange={(e) => setDraft((d) => ({ ...d, from: addDays(FIRST_DAY, Math.min(Number(e.target.value), b)) }))}
          />
          <input
            type="range"
            min={0}
            max={span}
            value={b}
            aria-label="End of the period"
            aria-valuetext={shortDay(draft.to)}
            onChange={(e) => setDraft((d) => ({ ...d, to: addDays(FIRST_DAY, Math.max(Number(e.target.value), a)) }))}
          />
          <div className="dual-ends" aria-hidden="true">
            <span>{shortDay(FIRST_DAY)}</span>
            <span>Today</span>
          </div>
        </div>
        <label>
          <span className="tile-label">To</span>
          <input
            type="date"
            min={draft.from}
            max={last}
            value={draft.to}
            onChange={(e) => e.target.value && setDraft((d) => ({ ...d, to: e.target.value }))}
          />
        </label>
      </div>
      <div className="range" role="group" aria-label="Quick periods">
        {PRESETS.map((n) => (
          <button
            key={n}
            className={preset === n ? "on" : ""}
            aria-pressed={preset === n}
            onClick={() => setDraft({ from: addDays(last, -n + 1), to: last })}
          >
            Last {n} days
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(DEMO);
  const [period, setPeriod] = useState<Period>(startPeriod);
  const [reports, setReports] = useState<Partial<Record<ReportName, Report>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [failed, setFailed] = useState<Partial<Record<ReportName, string>>>({});

  useEffect(() => {
    if (DEMO) return;
    return onAuthStateChanged(auth(), (u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  const load = useCallback(async () => {
    if (!DEMO && !user) return;
    setProblem(null);
    setReports({});
    setFailed({});
    const token = DEMO ? "" : await user!.getIdToken();
    await Promise.all(
      QUESTIONS.map(async ({ id }) => {
        // Each question fails on its own and says why, rather than leaving
        // "Loading…" up for good.
        try {
          const res = await fetch(`/api/report/${id}?from=${period.from}&to=${period.to}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
          const text = await res.text();
          let body: { error?: string } & Partial<Report> = {};
          try {
            body = JSON.parse(text);
          } catch {
            body = { error: `The server answered ${res.status} without data.` };
          }
          if (!res.ok) {
            const message = body.error ?? `The server answered ${res.status}.`;
            setFailed((f) => ({ ...f, [id]: message }));
            if (res.status === 401 || res.status === 403) setProblem(message);
            return;
          }
          setReports((r) => ({ ...r, [id]: body as Report }));
        } catch (e) {
          setFailed((f) => ({ ...f, [id]: e instanceof Error ? e.message : String(e) }));
        }
      }),
    );
  }, [user, period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) return <main className="page" />;
  if (!DEMO && !user) return <SignIn />;

  const isDemo = Object.values(reports).some((r) => r?.demo);

  return (
    <main className="page">
      <header className="top">
        <div>
          <div className="eyebrow">
            Pasoteca · production · {shortDay(period.from)} to {shortDay(period.to)}
          </div>
          <h1>How dancers use the app</h1>
        </div>
        <div className="top-controls">
          {!DEMO ? (
            <button className="link" onClick={() => signOut(auth())}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      <PeriodBar period={period} onChange={setPeriod} />

      {isDemo ? <p className="banner">Sample data: these numbers are made up, to show the layout.</p> : null}
      {problem ? <p className="banner error">{problem}</p> : null}

      <nav className="toc" aria-label="Questions">
        {QUESTIONS.map((q) => (
          <a key={q.id} href={`#${q.id}`}>
            {q.title}
          </a>
        ))}
      </nav>

      {QUESTIONS.map((q) => (
        <section key={q.id} id={q.id} className="question">
          <h2>{q.title}</h2>
          {reports[q.id] ? (
            <Answer id={q.id} report={reports[q.id]!} />
          ) : failed[q.id] ? (
            <p className="section-error">{failed[q.id]}</p>
          ) : (
            <p className="loading">Loading…</p>
          )}
          {Object.entries(reports[q.id]?.errors ?? {}).map(([section, message]) => (
            <p key={section} className="section-error">
              {section}: {message}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}

function SignIn() {
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="page signin">
      <div className="eyebrow">Pasoteca</div>
      <h1>How dancers use the app</h1>
      <p>Sign in with the Google account that has access.</p>
      <button
        className="primary"
        onClick={async () => {
          setError(null);
          try {
            await signInWithPopup(auth(), new GoogleAuthProvider());
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Sign in with Google
      </button>
      {error ? <p className="banner error">{error}</p> : null}
    </main>
  );
}

function Answer({ id, report }: { id: ReportName; report: Report }) {
  const s = report.sections;
  const first = (key: string) => s[key]?.[0] ?? {};
  switch (id) {
    case "glance": {
      const t = first("totals");
      const users = num(t.users);
      const classes = num(t.classes);
      const lastWeek = s.lastWeek?.[0];
      return (
        <Tiles
          items={[
            { label: "Dancers", value: users.toLocaleString(), note: "with an account, all time" },
            { label: "Classes", value: classes.toLocaleString(), note: `${num(t.moves).toLocaleString()} moves cut from them` },
            {
              label: "Classes per dancer",
              value: users ? (classes / users).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "–",
              note: "on average",
            },
            {
              label: "Active last 7 days",
              value: lastWeek ? num(lastWeek.active).toLocaleString() : "–",
              note: users && lastWeek ? `${percent(share(num(lastWeek.active), users))} of all dancers` : "dancers with an account",
            },
          ]}
        />
      );
    }
    case "health": {
      const ga = first("ga");
      const day = (d: unknown) => (typeof d === "string" && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : "–");
      const events = s.events ?? [];
      const firestore = s.firestore ?? [];
      return (
        <>
          <Tiles
            items={[
              { label: "Analytics days exported", value: num(ga.tables).toLocaleString(), note: `${day(ga.first_day)} to ${day(ga.last_day)}` },
              { label: "Analytics events", value: num(ga.events).toLocaleString(), note: ga.updated ? `last written ${ga.updated}` : "nothing exported yet" },
              {
                label: "App data copied",
                value: firestore.reduce((a, r) => a + num(r.docs), 0).toLocaleString(),
                note: firestore[0]?.updated ? `last copy ${firestore[0].updated}` : "no nightly copy yet",
              },
            ]}
          />
          <Card
            title="What the app sent in this period"
            note="Every Analytics event with how many dancers sent it. first_open only comes from a fresh install, so phones that had the app before the export began never count as new dancers."
          >
            <Breakdown
              unit="events"
              secondUnit="dancers"
              rows={events.map((e) => ({ label: String(e.event_name), value: num(e.events), second: num(e.users) }))}
            />
          </Card>
          <Card title="The nightly copy of the app's data" note="Documents per collection in the last copy, made at 03:15 Amsterdam time.">
            <Breakdown unit="documents" rows={firestore.map((r) => ({ label: String(r.collection), value: num(r.docs), detail: `copied ${r.updated}` }))} />
          </Card>
        </>
      );
    }
    case "funnel": {
      const steps = funnel(s.steps ?? []);
      const weakest = biggestDrop(steps);
      const opened = steps[0]?.users ?? 0;
      const guests = s.guests ?? [];
      const fromGuest = guests.filter((g) => g.from_guest === "true").reduce((a, g) => a + num(g.users), 0);
      const allSignups = guests.reduce((a, g) => a + num(g.users), 0);
      return (
        <>
          <Tiles
            items={[
              { label: "New accounts in this period", value: opened.toLocaleString() },
              { label: "Cut a first move", value: percent(steps[2]?.ofStart ?? null), note: `median ${duration(steps[2]?.medianMinutes ?? null)} after first opening` },
              { label: "Finished a session", value: percent(steps[4]?.ofStart ?? null) },
              { label: "Weakest step", value: weakest?.label ?? "–", note: weakest ? `${percent(weakest.ofPrevious)} of the step before` : undefined },
            ]}
          />
          <Card title="From account to Pro" note="Dancers who made an account in this period, and how many of them reached each step, as a guest before or after. Guests who never made an account are left out.">
            <Funnel steps={steps} weakest={weakest?.label ?? null} />
          </Card>
          <Card title="How new accounts were made" note={`${percent(share(fromGuest, allSignups))} started as a guest and kept their moves by signing up.`}>
            <Breakdown
              unit="accounts"
              rows={guests.map((g) => ({ label: `${g.method ?? "?"}${g.from_guest === "true" ? " · from guest" : ""}`, value: num(g.users) }))}
            />
          </Card>
        </>
      );
    }
    case "retention": {
      const list = cohorts(s.cohorts ?? []);
      return (
        <>
          <Tiles
            items={[
              { label: "Back in week 1", value: percent(averageRetention(list, 1)) },
              { label: "Back in week 4", value: percent(averageRetention(list, 4)) },
              { label: "Back in week 8", value: percent(averageRetention(list, 8)) },
            ]}
          />
          <Card title="Weekly cohorts" note="Each row is the dancers first seen that week; each cell the share of them active again that many weeks later.">
            <CohortGrid list={list} />
          </Card>
        </>
      );
    }
    case "weekly": {
      const weeks = (s.weeks ?? []).map((w) => ({
        week: String(w.week),
        values: { active_users: num(w.active_users), classes: num(w.classes), moves: num(w.moves), sessions: num(w.sessions) },
      }));
      return (
        <Card title="Each week" note="The latest week is highlighted, and may still be under way.">
          <WeeklyMultiples
            weeks={weeks}
            measures={[
              { key: "active_users", label: "Active dancers with an account" },
              { key: "classes", label: "Classes logged" },
              { key: "moves", label: "Moves cut" },
              { key: "sessions", label: "Sessions finished" },
            ]}
          />
        </Card>
      );
    }
    case "loop": {
      const totals = first("totals");
      const clip = first("timeToClip");
      const perClass = s.movesPerClass ?? [];
      const classes = perClass.reduce((a, r) => a + num(r.classes), 0);
      const unclipped = num(perClass.find((r) => String(r.bucket) === "0")?.classes);
      return (
        <>
          <Tiles
            items={[
              { label: "Classes never cut into moves", value: percent(share(unclipped, classes)), note: `${unclipped} of ${classes}` },
              { label: "Class to first move", value: duration(clip.median_hours == null ? null : num(clip.median_hours) * 60), note: `${percent(share(num(clip.same_day), num(clip.clipped_classes)))} the same day` },
              { label: "Moves rated", value: percent(share(num(totals.rated_moves), num(totals.moves))), note: `${num(totals.moves).toLocaleString()} moves in total` },
              { label: "Sessions per account", value: num(totals.accounts) ? (num(totals.sessions) / num(totals.accounts)).toFixed(1) : "–" },
            ]}
          />
          <Card title="Moves cut from each class" note="All time, from the nightly copy of the app's data.">
            <Breakdown unit="classes" rows={perClass.map((r) => ({ label: `${r.bucket} moves`, value: num(r.classes) }))} />
          </Card>
          <Card title="Average rating by age of the move" note="Rated moves only. A line that climbs means practice is working.">
            <TrendLine
              label="Average rating by weeks since the move was cut"
              min={0}
              max={10}
              points={(s.masteryByAge ?? []).map((r) => ({ x: num(r.weeks_old), y: num(r.avg_mastery), n: num(r.moves) }))}
            />
          </Card>
        </>
      );
    }
    case "styles": {
      const rows = (key: string) =>
        (s[key] ?? []).map((r) => ({ label: String(r.name), value: num(r.dancers), detail: `${num(r.classes)} classes logged` }));
      const top = s.danceStyles?.[0];
      return (
        <>
          <Tiles
            items={[
              { label: "Most danced style", value: top ? String(top.name) : "–", note: top ? `${num(top.dancers)} dancers` : undefined },
              { label: "Schools seen", value: String((s.schools ?? []).length) + ((s.schools ?? []).length >= 12 ? "+" : "") },
            ]}
          />
          <Card title="Dance styles" note="Dancers who logged at least one class in each style, all time.">
            <Breakdown unit="dancers" rows={rows("danceStyles")} />
          </Card>
          <Card title="Schools" note="Where dancers take their classes: places to reach more of them.">
            <Breakdown unit="dancers" rows={rows("schools")} />
          </Card>
          <Card title="Teachers">
            <Breakdown unit="dancers" rows={rows("instructors")} />
          </Card>
        </>
      );
    }
    case "ideas": {
      const ideas = s.top ?? [];
      return (
        <Card title="Ideas board, most votes first" note="All time. Who posted an idea is not copied into the dashboard's data.">
          {ideas.length === 0 ? (
            <p className="empty">No ideas posted yet.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Idea</th>
                    <th>Status</th>
                    <th>Votes</th>
                    <th>Posted</th>
                  </tr>
                </thead>
                <tbody>
                  {ideas.map((idea, i) => (
                    <tr key={i}>
                      <td>{String(idea.title)}</td>
                      <td>{String(idea.status)}</td>
                      <td className="num">{num(idea.votes)}</td>
                      <td>{String(idea.posted ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      );
    }
    case "friction": {
      const clipper = s.clipper ?? [];
      const left = num(clipper.find((r) => r.saved === "false")?.visits);
      const visits = clipper.reduce((a, r) => a + num(r.visits), 0);
      const dl = first("downloads");
      const done = first("startedVsDone");
      return (
        <>
          <Tiles
            items={[
              { label: "Clipper left without saving", value: percent(share(left, visits)), note: `${left} of ${visits} visits` },
              { label: "Class video download", value: dl.p50_seconds == null ? "–" : `${num(dl.p50_seconds)} s`, note: `median · 1 in 10 waits ${num(dl.p90_seconds)} s or more` },
              { label: "Downloads that failed", value: percent(share(num(dl.failed), num(dl.downloads)), 1), note: `${num(dl.failed)} of ${num(dl.downloads)}` },
            ]}
          />
          <Card title="Started against finished" note="Dancers who set out to do each thing, and those who got it done.">
            <Breakdown
              unit="dancers"
              rows={[
                { label: "Started a class", value: num(done.started_class) },
                { label: "Saved a class", value: num(done.created_class) },
                { label: "Opened the clipper", value: num(done.started_clipping) },
                { label: "Cut a move", value: num(done.clipped) },
              ]}
            />
          </Card>
          <Card title="Where class videos come from">
            <Breakdown unit="videos" rows={(s.videoSources ?? []).map((r) => ({ label: String(r.source ?? "?"), value: num(r.videos) }))} />
          </Card>
        </>
      );
    }
    case "sharing": {
      const push = s.push ?? [];
      const granted = num(push.find((r) => r.granted === "true")?.users);
      const asked = push.reduce((a, r) => a + num(r.users), 0);
      const inbox = s.inbox ?? [];
      const answered = inbox.filter((r) => r.status !== "pending");
      const kept = num(answered.filter((r) => r.status === "accepted").reduce((a, r) => a + num(r.shares), 0));
      const strangers = (s.opened ?? []).filter((r) => r.signed_in === "false").reduce((a, r) => a + num(r.opens), 0);
      return (
        <>
          <Tiles
            items={[
              { label: "Shares kept", value: percent(share(kept, answered.reduce((a, r) => a + num(r.shares), 0))), note: "of those answered" },
              { label: "Link opens by non-users", value: strangers.toLocaleString(), note: "dancers a share could bring in" },
              { label: "Allowed notifications", value: percent(share(granted, asked)), note: `${granted} of ${asked} asked` },
            ]}
          />
          <Card title="Shares sent">
            <Breakdown unit="shares" rows={(s.sent ?? []).map((r) => ({ label: `${r.kind} · by ${r.via}`, value: num(r.shares) }))} />
          </Card>
          <Card title="Shares by username, by outcome" note="All time.">
            <Breakdown unit="shares" rows={inbox.map((r) => ({ label: `${r.kind} · ${r.status}`, value: num(r.shares) }))} />
          </Card>
        </>
      );
    }
    case "money": {
      const paywall = s.paywall ?? [];
      const viewers = paywall.reduce((a, r) => a + num(r.viewers), 0);
      const pro = paywall.reduce((a, r) => a + num(r.started_pro), 0);
      return (
        <>
          <Tiles
            items={[
              { label: "Saw the paywall", value: viewers.toLocaleString() },
              { label: "Started Pro within a week", value: percent(share(pro, viewers), 1), note: `${pro} dancers` },
            ]}
          />
          <Card title="Conversion by what brought the paywall up" note="Share of those who saw it that started Pro within 7 days.">
            <Breakdown
              unit="converted"
              format={(v) => percent(v, 1)}
              rows={paywall.map((r) => ({
                label: String(r.reason ?? "?"),
                value: share(num(r.started_pro), num(r.viewers)) ?? 0,
                detail: `${num(r.started_pro)} of ${num(r.viewers)} viewers`,
              }))}
            />
          </Card>
          <Card title="Plans started">
            <Breakdown
              unit="starts"
              rows={(s.plans ?? []).map((r) => ({ label: `${r.plan}${r.with_trial === "true" ? " · trial" : ""}`, value: num(r.starts) }))}
            />
          </Card>
        </>
      );
    }
  }
}
