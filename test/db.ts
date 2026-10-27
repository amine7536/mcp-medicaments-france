import { env } from "cloudflare:workers";

/** Empties the tables the ingest writes. */
export async function resetDb(): Promise<void> {
	await env.DB.batch(
		["bdpm_dispo", "shortages", "status_history", "ingest_runs"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
	);
}

export async function count(sql: string, ...params: unknown[]): Promise<number> {
	const row = await env.DB.prepare(sql).bind(...params).first<{ n: number }>();
	return row?.n ?? 0;
}
