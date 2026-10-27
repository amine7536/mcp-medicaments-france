import { env } from "cloudflare:workers";
import type { IngestOutcome, IngestResult } from "../src/ingest/run";

/** Empties the tables the ingest writes. */
export async function resetDb(): Promise<void> {
	await env.DB.batch(
		["bdpm_dispo", "shortages", "status_history", "ingest_runs", "shortage_matches", "medicines"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
	);
}

export async function count(sql: string, ...params: unknown[]): Promise<number> {
	const row = await env.DB.prepare(sql).bind(...params).first<{ n: number }>();
	return row?.n ?? 0;
}

/** Narrows a `runIngest` outcome to a run that claimed a row. */
export function ran(outcome: IngestOutcome): IngestResult {
	if (!("id" in outcome)) throw new Error(`no run: ${JSON.stringify(outcome)}`);
	return outcome;
}
