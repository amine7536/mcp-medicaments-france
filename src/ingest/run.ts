import { sha256Hex } from "../lib/hash";
import { type DetailFields, type ListRow, parseDetail, parseList, type Status } from "./ansm";
import { applyDiff, type DetailOutcome, type DiffCounts, loadShortages, needsDetail } from "./diff";
import { ingestDispo } from "./dispo";
import { type ExtractedFields, type Extractor, NO_FIELDS, workersAiExtractor } from "./extract";
import { ANSM_LIST_URL, ANSM_ORIGIN, errorMessage, type Fetcher, get, log } from "./http";
import { afterIngest } from "./match";
import { checkSanity } from "./sanity";

export const RUNNING_TTL_MS = 20 * 60 * 1000;
const DETAIL_CONCURRENCY = 4;
const MESSAGE_MAX = 500;

interface IngestOptions {
	/** Minimum rows of the BDPM shortage file (default 200). */
	dispoMinRows?: number;
	/** Minimum delay between two request starts in one detail lane (default 250 ms). */
	detailIntervalMs?: number;
	/** Hook called after a successful diff (default `afterIngest`). */
	afterIngest?: typeof afterIngest;
	/** Reads scope and expected return from a page's observation lines (default: Workers AI on `env.AI`). */
	extract?: Extractor;
	/** Timeout of one model call (default 30 s). */
	extractTimeoutMs?: number;
	/** Time after the detail phase starts past which no model call starts (default 60 s). */
	extractBudgetMs?: number;
}

/** List statuses whose detail page is read by the model. */
const EXTRACTED_STATUSES = new Set<Status>(["rupture", "tension"]);

type RunStatus = "ok" | "aborted" | "error";

export interface IngestResult {
	id: number;
	status: RunStatus;
	message: string;
	counts: Partial<DiffCounts>;
	detailsFetched: number;
}

interface DetailOptions {
	intervalMs: number;
	extract: Extractor;
	timeoutMs: number;
	budgetMs: number;
}

interface DetailsResult {
	details: Map<string, DetailOutcome>;
	/** Detail pages requested. */
	fetched: number;
	detailFailed: number;
	extractFailed: number;
}

/**
 * Fetches and parses detail pages with `DETAIL_CONCURRENCY` lanes, each spacing its request starts.
 * Rupture and tension pages go through the extractor; once the budget is spent, they are neither fetched nor extracted.
 */
async function fetchDetails(rows: ListRow[], fetcher: Fetcher, opts: DetailOptions): Promise<DetailsResult> {
	const result: DetailsResult = { details: new Map(), fetched: 0, detailFailed: 0, extractFailed: 0 };
	const phaseStart = Date.now();
	const extractFailed = (id: string): null => {
		result.details.set(id, { ok: false });
		result.extractFailed++;
		return null;
	};
	const overBudget = (id: string): boolean => {
		if (Date.now() - phaseStart < opts.budgetMs) return false;
		log("extract_failed", { id, reason: "budget" });
		extractFailed(id);
		return true;
	};
	/** The extracted fields of a page, or null after recording a failed or skipped extraction (the extractor logs its own failures). */
	const extract = async (id: string, lines: string[]): Promise<ExtractedFields | null> => {
		if (overBudget(id)) return null;
		const outcome = await opts.extract(lines, id, opts.timeoutMs);
		return outcome.ok ? outcome.fields : extractFailed(id);
	};
	let next = 0;
	const lane = async (): Promise<void> => {
		while (next < rows.length) {
			const row = rows[next++] as ListRow;
			const extracted = EXTRACTED_STATUSES.has(row.status);
			if (extracted && overBudget(row.id)) continue;
			const started = Date.now();
			result.fetched++;
			try {
				const res = await get(fetcher, ANSM_ORIGIN + row.ansm_path);
				if (res.status !== 200) {
					await res.body?.cancel();
					throw new Error(`HTTP ${res.status}`);
				}
				const page = await parseDetail(await res.text());
				const fields = extracted ? await extract(row.id, page.observations) : NO_FIELDS;
				if (fields !== null) {
					const merged: DetailFields = { situation_start: page.situation_start, dci: page.dci, ...fields };
					result.details.set(row.id, { ok: true, detail: { ...merged, detail_hash: await sha256Hex(JSON.stringify(merged)) } });
				}
			} catch (err) {
				result.details.set(row.id, { ok: false });
				result.detailFailed++;
				log("detail_failed", { id: row.id, reason: errorMessage(err) });
			}
			const wait = opts.intervalMs - (Date.now() - started);
			if (wait > 0 && next < rows.length) await scheduler.wait(wait);
		}
	};
	await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, rows.length) }, lane));
	return result;
}

export type IngestOutcome = IngestResult | { skipped: "ingest_running" } | { error: string };

const CLOSE_SQL =
	"UPDATE ingest_runs SET status = ?, finished_at = ?, entries_seen = ?, entries_new = ?, entries_changed = ?, entries_delisted = ?, message = ? WHERE id = ?";

/** Closes stale running runs, then claims a new run row; `null` when another run holds the claim. */
async function claimRun(db: D1Database, now: string, staleBefore: string): Promise<number | null> {
	await db
		.prepare(
			"UPDATE ingest_runs SET status = 'error', finished_at = ?, message = 'stale running run' WHERE source = 'ansm' AND status = 'running' AND started_at < ?",
		)
		.bind(now, staleBefore)
		.run();
	const claimed = await db
		.prepare(
			"INSERT INTO ingest_runs (source, status, started_at) SELECT 'ansm', 'running', ?1 WHERE NOT EXISTS (SELECT 1 FROM ingest_runs WHERE source = 'ansm' AND status = 'running') RETURNING id",
		)
		.bind(now)
		.first<{ id: number }>();
	return claimed?.id ?? null;
}

/** One ANSM ingest: claim, list, sanity, BDPM shortage file, details, diff, hook, run bookkeeping. */
export async function runIngest(env: Env, fetcher: Fetcher, opts: IngestOptions = {}): Promise<IngestOutcome> {
	const db = env.DB;
	const startedAt = new Date();
	const now = startedAt.toISOString();
	const staleBefore = new Date(startedAt.getTime() - RUNNING_TTL_MS).toISOString();

	let id: number | null;
	try {
		id = await claimRun(db, now, staleBefore);
	} catch (err) {
		const error = errorMessage(err).slice(0, MESSAGE_MAX);
		console.error(JSON.stringify({ event: "ingest_error", reason: error }));
		return { error };
	}
	if (id === null) return { skipped: "ingest_running" };

	let status: RunStatus = "ok";
	let counts: Partial<DiffCounts> = {};
	let detailsFetched = 0;
	let message = "";
	const parts: string[] = [];
	const close = (): Promise<unknown> =>
		db
			.prepare(CLOSE_SQL)
			.bind(
				status,
				new Date().toISOString(),
				counts.entries_seen ?? null,
				counts.entries_new ?? null,
				counts.entries_changed ?? null,
				counts.entries_delisted ?? null,
				message,
				id,
			)
			.run();

	try {
		const previous = await db
			.prepare("SELECT entries_seen FROM ingest_runs WHERE source = 'ansm' AND status = 'ok' ORDER BY started_at DESC LIMIT 1")
			.first<{ entries_seen: number | null }>();
		const bootstrap = previous === null;
		if (bootstrap) parts.push("bootstrap");

		const res = await get(fetcher, ANSM_LIST_URL);
		if (res.status !== 200) {
			await res.body?.cancel();
			throw new Error(`list fetch failed: HTTP ${res.status}`);
		}
		const rows = await parseList(await res.text());
		counts = { entries_seen: rows.length };

		const stored = await loadShortages(db);
		const listedIds = new Set([...stored.values()].filter((s) => s.listed === 1).map((s) => s.id));
		const sanity = checkSanity(rows, { previousOkSeen: previous?.entries_seen ?? null, currentlyListedIds: listedIds });
		if (!sanity.ok) {
			status = "aborted";
			parts.push(sanity.reason);
		} else {
			const dispo = await ingestDispo(db, fetcher, opts.dispoMinRows);
			const toFetch = rows.filter((row) => needsDetail(row, stored.get(row.id)));
			const { details, fetched, detailFailed, extractFailed } = await fetchDetails(toFetch, fetcher, {
				intervalMs: opts.detailIntervalMs ?? 250,
				extract: opts.extract ?? workersAiExtractor(env.AI),
				timeoutMs: opts.extractTimeoutMs ?? 30_000,
				budgetMs: opts.extractBudgetMs ?? 60_000,
			});
			detailsFetched = fetched;
			counts = await applyDiff(db, rows, stored, details, { now, bootstrap });
			if (detailFailed > 0) parts.push(`detail_failed=${detailFailed}`);
			if (extractFailed > 0) parts.push(`extract_failed=${extractFailed}`);
			parts.push(`dispo=${dispo}`);
			try {
				parts.push(await (opts.afterIngest ?? afterIngest)(env, { id, bootstrap }));
			} catch (err) {
				log("hook_failed", { id, reason: errorMessage(err) });
			}
		}
		message = parts.filter((p) => p !== "").join("; ");
		await close();
	} catch (err) {
		console.error(JSON.stringify({ event: "ingest_error", id, reason: errorMessage(err) }));
		status = "error";
		message = errorMessage(err).slice(0, MESSAGE_MAX);
		try {
			await close();
		} catch (closeErr) {
			console.error(JSON.stringify({ event: "ingest_close_failed", id, reason: errorMessage(closeErr) }));
		}
	} finally {
		log("ingest_done", { id, status, message, details_fetched: detailsFetched, ...counts });
	}
	return { id, status, message, counts, detailsFetched };
}
