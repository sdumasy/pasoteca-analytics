import { BigQuery } from "@google-cloud/bigquery";
import type { Query, Row } from "./reports.ts";

let client: BigQuery | null = null;

/// Runs [query] and returns its rows as plain values: BigQuery hands back
/// wrapper objects for dates and big numbers, which JSON would mangle.
export async function run(query: Query, project: string): Promise<Row[]> {
  client ??= new BigQuery({ projectId: project });
  const [rows] = await client.query({ query: query.sql, params: query.params, useLegacySql: false });
  return rows.map((row: Record<string, unknown>) => {
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) out[key] = plain(value);
    return out;
  });
}

function plain(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "object" && "value" in (value as object)) {
    const inner = (value as { value: unknown }).value;
    const asNumber = Number(inner);
    return typeof inner === "string" && inner !== "" && !Number.isNaN(asNumber) && /^-?\d+(\.\d+)?$/.test(inner)
      ? asNumber
      : String(inner);
  }
  return String(value);
}
