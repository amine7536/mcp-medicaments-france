import { STATUSES, type Status } from "./ingest/ansm";
import { log } from "./ingest/http";
import { RUNNING_TTL_MS } from "./ingest/run";
import { STALE_AFTER_MS } from "./mcp/envelope";
import { PROBABLE_MATCH_BELOW } from "./mcp/schemas";

export const HEALTH_MAX_AGE_SECONDS = 300;

export type HealthStatus = "ok" | "stale" | "degraded";

interface Run {
	started_at: string;
	finished_at: string | null;
	status: string;
	message: string | null;
}

export interface Health {
	status: HealthStatus;
	ansm: { last_ok_at: string | null; last_run: Run | null };
	bdpm: { release: string | null; imported_at: string | null };
	counts: { listed: number; by_status: Record<Status, number>; medicines: number; mitm: number; bdpm_dispo: number };
	match: { listed: number; matched_ge_0_8: number; rate: number | null };
	quality: { unknown_status: number; scope_inconnu: number; return_unparsed: number; unmatched: number };
	generated_at: string;
}

/** An expected return that cannot be parsed because ANSM states it is undetermined. */
const UNDETERMINED = /indétermin/i;

const LISTED_SQL = `SELECT
	COUNT(*) AS listed,
	COALESCE(SUM(EXISTS (SELECT 1 FROM shortage_matches m WHERE m.shortage_id = s.id AND m.is_best = 1 AND m.confidence >= ?1)), 0) AS matched,
	COALESCE(SUM(s.status = 'autre'), 0) AS unknown_status,
	COALESCE(SUM(s.status IN ('rupture', 'tension') AND s.scope = 'inconnu'), 0) AS scope_inconnu,
	COALESCE(SUM(NOT EXISTS (SELECT 1 FROM shortage_matches m WHERE m.shortage_id = s.id)), 0) AS unmatched
FROM shortages s WHERE s.listed = 1`;

/** Health status: `stale` without a recent ok ANSM run, else `degraded` when the latest run failed or is stuck. */
export function healthStatus(lastOkAt: string | null, lastRun: Run | null, now: Date): HealthStatus {
	if (lastOkAt === null || now.getTime() - Date.parse(lastOkAt) > STALE_AFTER_MS) return "stale";
	if (lastRun === null) return "ok";
	if (lastRun.status === "aborted" || lastRun.status === "error") return "degraded";
	if (lastRun.status === "running" && now.getTime() - Date.parse(lastRun.started_at) > RUNNING_TTL_MS) return "degraded";
	return "ok";
}

/** Ingest status, listed counts, match rate and data-quality counters, read in one D1 batch. */
export async function loadHealth(db: D1Database, now: Date): Promise<Health> {
	const [lastOk, lastRun, bdpm, byStatus, totals, listed, unparsed] = await db.batch([
		db.prepare("SELECT finished_at FROM ingest_runs WHERE source = 'ansm' AND status = 'ok' ORDER BY finished_at DESC, id DESC LIMIT 1"),
		db.prepare("SELECT started_at, finished_at, status, message FROM ingest_runs WHERE source = 'ansm' ORDER BY started_at DESC, id DESC LIMIT 1"),
		db.prepare(
			"SELECT bdpm_release AS release, finished_at AS imported_at FROM ingest_runs WHERE source = 'bdpm' AND status = 'ok' ORDER BY finished_at DESC, id DESC LIMIT 1",
		),
		db.prepare("SELECT status, COUNT(*) AS n FROM shortages WHERE listed = 1 GROUP BY status"),
		db.prepare("SELECT (SELECT COUNT(*) FROM medicines) AS medicines, (SELECT COUNT(*) FROM mitm) AS mitm, (SELECT COUNT(*) FROM bdpm_dispo) AS bdpm_dispo"),
		db.prepare(LISTED_SQL).bind(PROBABLE_MATCH_BELOW),
		db.prepare(
			"SELECT expected_return_raw AS raw FROM shortages WHERE listed = 1 AND status IN ('rupture', 'tension') AND expected_return_raw IS NOT NULL AND expected_return_earliest IS NULL",
		),
	]);
	const first = <T>(r: D1Result | undefined): T | null => (r?.results[0] as T | undefined) ?? null;

	const lastOkAt = first<{ finished_at: string }>(lastOk)?.finished_at ?? null;
	const run = first<Run>(lastRun);
	const statusCounts = new Map(((byStatus?.results ?? []) as Array<{ status: string; n: number }>).map((r) => [r.status, r.n]));
	const t = first<{ medicines: number; mitm: number; bdpm_dispo: number }>(totals) ?? { medicines: 0, mitm: 0, bdpm_dispo: 0 };
	const l = first<{ listed: number; matched: number; unknown_status: number; scope_inconnu: number; unmatched: number }>(listed);
	const listedCount = l?.listed ?? 0;
	const matched = l?.matched ?? 0;
	const returnUnparsed = ((unparsed?.results ?? []) as Array<{ raw: string }>).filter((r) => !UNDETERMINED.test(r.raw)).length;

	return {
		status: healthStatus(lastOkAt, run, now),
		ansm: { last_ok_at: lastOkAt, last_run: run },
		bdpm: first<Health["bdpm"]>(bdpm) ?? { release: null, imported_at: null },
		counts: {
			listed: listedCount,
			by_status: Object.fromEntries(STATUSES.map((s) => [s, statusCounts.get(s) ?? 0])) as Record<Status, number>,
			...t,
		},
		match: { listed: listedCount, matched_ge_0_8: matched, rate: listedCount === 0 ? null : Math.round((matched / listedCount) * 1000) / 1000 },
		quality: {
			unknown_status: l?.unknown_status ?? 0,
			scope_inconnu: l?.scope_inconnu ?? 0,
			return_unparsed: returnUnparsed,
			unmatched: l?.unmatched ?? 0,
		},
		generated_at: now.toISOString(),
	};
}

/** `GET /health`: served from `caches.default` when present, else computed and cached for 5 minutes (503s included). */
export async function handleHealth(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const { origin, pathname } = new URL(request.url);
	const key = new Request(origin + pathname);
	const cache = caches.default;
	const cached = await cache.match(key);
	if (cached) return cached;

	let health: Health;
	try {
		health = await loadHealth(env.DB, new Date());
	} catch (err) {
		log("health_error", { error: String(err) }, "error");
		return Response.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
	}
	const res = Response.json(health, {
		status: health.status === "ok" ? 200 : 503,
		headers: { "Cache-Control": `public, max-age=${HEALTH_MAX_AGE_SECONDS}` },
	});
	ctx.waitUntil(cache.put(key, res.clone()));
	return res;
}
