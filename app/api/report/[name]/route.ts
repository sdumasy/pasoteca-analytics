import { NextResponse } from "next/server";
import { cert, getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { isReportName, queriesFor, type Row } from "@/lib/reports";
import { demoReport } from "@/lib/demo";
import { allowedEmails, mayView } from "@/lib/access";
import { run } from "@/lib/bigquery";

export const dynamic = "force-dynamic";

const PROJECT = process.env.GCP_PROJECT ?? "p-pasoteca";
const DEMO = process.env.DEMO === "1";

function admin() {
  if (getApps().length === 0) {
    const key = process.env.FIREBASE_ADMIN_KEY;
    initializeApp({ projectId: PROJECT, credential: key ? cert(JSON.parse(key)) : applicationDefault() });
  }
  return getAuth();
}

/// Ten minutes of answers kept per report and range: the data under it
/// changes once a day, and a query costs a little every time.
const cache = new Map<string, { at: number; body: unknown }>();
const TTL_MS = 10 * 60 * 1000;

export async function GET(request: Request, { params }: { params: { name: string } }) {
  const name = params.name;
  if (!isReportName(name)) return NextResponse.json({ error: "No such report." }, { status: 404 });

  if (!DEMO) {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    let decoded = null;
    try {
      decoded = token ? await admin().verifyIdToken(token) : null;
    } catch {
      decoded = null;
    }
    if (!decoded) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (!mayView(decoded, allowedEmails(process.env.ALLOWED_EMAILS))) {
      return NextResponse.json({ error: "This account is not on the list for this dashboard." }, { status: 403 });
    }
  }

  const days = Math.min(365, Math.max(7, Number(new URL(request.url).searchParams.get("days")) || 30));
  if (DEMO) return NextResponse.json({ demo: true, sections: demoReport(name) });

  const key = `${name}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body);

  const gaDataset = process.env.GA_DATASET;
  if (!gaDataset) return NextResponse.json({ error: "GA_DATASET is not set: link Google Analytics to BigQuery first." }, { status: 500 });

  const queries = queriesFor(name, { project: PROJECT, gaDataset, fsDataset: process.env.FS_DATASET ?? "firestore_export" }, days);
  const sections: Record<string, Row[]> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    Object.entries(queries).map(async ([section, query]) => {
      try {
        sections[section] = await run(query, PROJECT);
      } catch (e) {
        // One table not there yet (the GA export's first day, a collection
        // never written) must not blank the rest of the page.
        errors[section] = e instanceof Error ? e.message.split("\n")[0] : String(e);
        sections[section] = [];
      }
    }),
  );
  const body = { demo: false, days, sections, errors };
  cache.set(key, { at: Date.now(), body });
  return NextResponse.json(body);
}
