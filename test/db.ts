import { env } from "cloudflare:workers";
import { vi } from "vitest";
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

/** Spies on `env.DB` from now on; every statement is run directly or batched, a batch counting as one query. */
export function queryCount(): { queries: () => number; batches: () => number } {
	const prepare = vi.spyOn(env.DB, "prepare");
	const batch = vi.spyOn(env.DB, "batch");
	const batches = () => batch.mock.calls.length;
	const batched = () => batch.mock.calls.reduce((n, c) => n + c[0].length, 0);
	return { queries: () => prepare.mock.calls.length - batched() + batches(), batches };
}
