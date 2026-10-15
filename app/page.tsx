"use client";

import { useCallback, useEffect, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { Breakdown, Card, CohortGrid, Funnel, Tiles, TrendLine, WeeklyMultiples } from "@/components/charts";
import { averageRetention, biggestDrop, cohorts, duration, funnel, num, percent, share } from "@/lib/derive";
import type { ReportName, Row } from "@/lib/reports";

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
}

const QUESTIONS: { id: ReportName; title: string }[] = [
  { id: "funnel", title: "Do new dancers get to their first move?" },
  { id: "retention", title: "Do they come back?" },
  { id: "weekly", title: "How busy is the app, week to week?" },
  { id: "loop", title: "Is the class → moves → practice loop working?" },
  { id: "friction", title: "Where does it get in the way?" },
  { id: "sharing", title: "Does sharing bring dancers in?" },
  { id: "money", title: "Does the paywall convert?" },
];

const RANGES = [7, 30, 90] as const;

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(DEMO);
  const [days, setDays] = useState<number>(30);
  const [reports, setReports] = useState<Partial<Record<ReportName, Report>>>({});
  const [problem, setProblem] = useState<string | null>(null);

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
    const token = DEMO ? "" : await user!.getIdToken();
    await Promise.all(
      QUESTIONS.map(async ({ id }) => {
        const res = await fetch(`/api/report/${id}?days=${days}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
        const body = await res.json();
        if (!res.ok) {
          setProblem(body.error ?? `Could not load ${id}.`);
          return;
        }
        setReports((r) => ({ ...r, [id]: body }));
      }),
    );
  }, [user, days]);

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
          <div className="eyebrow">Pasoteca · production</div>
          <h1>How dancers use the app</h1>
        </div>
        <div className="top-controls">
          <div className="range" role="group" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r} className={r === days ? "on" : ""} onClick={() => setDays(r)} aria-pressed={r === days}>
                {r} days
              </button>
            ))}
          </div>
          {!DEMO ? (
            <button className="link" onClick={() => signOut(auth())}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>

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
          {reports[q.id] ? <Answer id={q.id} report={reports[q.id]!} days={days} /> : <p className="loading">Loading…</p>}
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

function Answer({ id, report, days }: { id: ReportName; report: Report; days: number }) {
  const s = report.sections;
  const first = (key: string) => s[key]?.[0] ?? {};
  switch (id) {
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
              { label: `New dancers, last ${days} days`, value: opened.toLocaleString() },
              { label: "Cut a first move", value: percent(steps[2]?.ofStart ?? null), note: `median ${duration(steps[2]?.medianMinutes ?? null)} after opening` },
              { label: "Made an account", value: percent(steps[3]?.ofStart ?? null) },
              { label: "Weakest step", value: weakest?.label ?? "–", note: weakest ? `${percent(weakest.ofPrevious)} of the step before` : undefined },
            ]}
          />
          <Card title="From first open to Pro" note="Dancers who first opened the app in this period, and how many reached each step since.">
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
              { key: "active_users", label: "Active dancers" },
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
