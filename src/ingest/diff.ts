import { isUndetermined } from "../lib/dates";
import type { Detail, DetailFields, ListRow } from "./ansm";
import { log } from "./http";

type DetailColumns = Omit<DetailFields, "dci">;

interface StoredShortage extends DetailColumns {
	id: string;
	status: string;
	dci_raw: string | null;
	list_hash: string;
	detail_hash: string | null;
	listed: number;
	missed_runs: number;
	expected_return_lost_raw: string | null;
	expected_return_lost_earliest: string | null;
	expected_return_lost_latest: string | null;
	expected_return_lost_precision: string | null;
	expected_return_lost_part: string | null;
}

/** An expected return as stored: the raw line and its window. */
interface StoredReturn {
	raw: string | null;
	earliest: string | null;
	latest: string | null;
	precision: string | null;
	part: string | null;
}

export type DetailOutcome = { ok: true; detail: Detail } | { ok: false };

interface DiffContext {
	now: string;
	bootstrap: boolean;
}

export interface DiffCounts {
	entries_seen: number;
	entries_new: number;
	entries_changed: number;
	entries_delisted: number;
}

const BATCH_SIZE = 100;
const DELIST_AFTER_MISSES = 2;
const RETURN_TRACKED = new Set(["rupture", "tension"]);

const DETAIL_KEYS = [
	"situation_start",
	"scope",
	"scope_raw",
	"expected_return_earliest",
	"expected_return_latest",
	"expected_return_precision",
	"expected_return_part",
	"expected_return_raw",
] as const satisfies readonly (keyof DetailColumns)[];

const EMPTY_DETAIL: DetailColumns = {
	situation_start: null,
	scope: "inconnu",
	scope_raw: null,
	expected_return_earliest: null,
	expected_return_latest: null,
	expected_return_precision: null,
	expected_return_part: null,
	expected_return_raw: null,
};

const LIST_KEYS = [
	"ansm_path",
	"raw_name",
	"raw_name_norm",
	"status",
	"status_raw",
	"returned_at",
	"therapeutic_areas",
	"therapeutic_areas_norm",
	"ansm_updated_at",
	"list_hash",
] as const satisfies readonly (keyof ListRow)[];

/** Characters ANSM adds or drops when it rewords an unchanged expected return ("prévue X" -> "prévue : X."). */
const RETURN_WORDING_NOISE = /[ \t\n\r\u00a0\u2009\u202f.:;,]/g;

const LOST_KEYS = [
	"expected_return_lost_raw",
	"expected_return_lost_earliest",
	"expected_return_lost_latest",
	"expected_return_lost_precision",
	"expected_return_lost_part",
] as const;

const currentReturn = (d: DetailColumns): StoredReturn => ({
	raw: d.expected_return_raw,
	earliest: d.expected_return_earliest,
	latest: d.expected_return_latest,
	precision: d.expected_return_precision,
	part: d.expected_return_part,
});

const lostReturn = (s: StoredShortage): StoredReturn => ({
	raw: s.expected_return_lost_raw,
	earliest: s.expected_return_lost_earliest,
	latest: s.expected_return_lost_latest,
	precision: s.expected_return_lost_precision,
	part: s.expected_return_lost_part,
});

/** Same expected return: undetermined counts as no return, then same stored window, then same text once lowercased and stripped of spacing and punctuation. */
function sameExpectedReturn(a: StoredReturn, b: StoredReturn): boolean {
	const x = a.raw !== null && isUndetermined(a.raw) ? null : a.raw;
	const y = b.raw !== null && isUndetermined(b.raw) ? null : b.raw;
	if (x === null || y === null) return x === y;
	if (
		a.precision !== null &&
		b.precision !== null &&
		a.precision === b.precision &&
		a.earliest === b.earliest &&
		a.latest === b.latest &&
		a.part === b.part
	)
		return true;
	return x.toLowerCase().replace(RETURN_WORDING_NOISE, "") === y.toLowerCase().replace(RETURN_WORDING_NOISE, "");
}

export async function loadShortages(db: D1Database): Promise<Map<string, StoredShortage>> {
	const { results } = await db
		.prepare(
			`SELECT id, status, dci_raw, list_hash, detail_hash, listed, missed_runs, ${LOST_KEYS.join(", ")}, ${DETAIL_KEYS.join(", ")} FROM shortages`,
		)
		.all<StoredShortage>();
	return new Map(results.map((r) => [r.id, r]));
}

/** A detail page is fetched for new entries, changed list rows and previously failed details. */
export function needsDetail(row: ListRow, stored: StoredShortage | undefined): boolean {
	return stored === undefined || stored.list_hash !== row.list_hash || stored.detail_hash === null;
}

function pickDetail(source: DetailColumns): DetailColumns {
	return Object.fromEntries(DETAIL_KEYS.map((k) => [k, source[k]])) as unknown as DetailColumns;
}

/** Writes the list rows and detail outcomes to `shortages` and records changes in `status_history`. */
export async function applyDiff(
	db: D1Database,
	rows: ListRow[],
	stored: Map<string, StoredShortage>,
	details: Map<string, DetailOutcome>,
	ctx: DiffContext,
): Promise<DiffCounts> {
	const stmts: D1PreparedStatement[] = [];
	const counts: DiffCounts = { entries_seen: rows.length, entries_new: 0, entries_changed: 0, entries_delisted: 0 };
	const history = (
		id: string,
		type: string,
		v: { old_status?: string | null; new_status?: string | null; old_er?: string | null; new_er?: string | null } = {},
	): void => {
		if (ctx.bootstrap) return;
		stmts.push(
			db
				.prepare(
					"INSERT INTO status_history (shortage_id, change_type, old_status, new_status, old_expected_return, new_expected_return, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				)
				.bind(id, type, v.old_status ?? null, v.new_status ?? null, v.old_er ?? null, v.new_er ?? null, ctx.now),
		);
	};

	const seen = new Set<string>();
	for (const row of rows) {
		seen.add(row.id);
		const old = stored.get(row.id);
		const outcome = details.get(row.id);
		const detail = outcome?.ok ? pickDetail(outcome.detail) : old ? pickDetail(old) : EMPTY_DETAIL;
		const detail_hash = outcome === undefined ? (old?.detail_hash ?? null) : outcome.ok ? outcome.detail.detail_hash : null;
		const dci_raw = row.dci_raw ?? (outcome?.ok ? outcome.detail.dci : (old?.dci_raw ?? null));
		const values = [...LIST_KEYS.map((k) => row[k]), dci_raw, ...DETAIL_KEYS.map((k) => detail[k]), detail_hash];

		if (old === undefined) {
			counts.entries_new++;
			const cols = ["id", ...LIST_KEYS, "dci_raw", ...DETAIL_KEYS, "detail_hash", "first_seen_at", "last_seen_at", "missed_runs", "listed"];
			stmts.push(
				db
					.prepare(`INSERT INTO shortages (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
					.bind(row.id, ...values, ctx.now, ctx.now, 0, 1),
			);
			history(row.id, "new", { new_status: row.status, new_er: detail.expected_return_raw });
			continue;
		}

		if (old.status !== row.status) {
			counts.entries_changed++;
			history(row.id, "status_change", { old_status: old.status, new_status: row.status });
		}
		const next = currentReturn(detail);
		let lost: StoredReturn | null = null;
		if (RETURN_TRACKED.has(old.status) && RETURN_TRACKED.has(row.status)) {
			// After a silent drop, a returning line is compared against the dropped return, not the stored null.
			const comeback = old.expected_return_raw === null && old.expected_return_lost_raw !== null && next.raw !== null;
			const before = comeback ? lostReturn(old) : currentReturn(old);
			if (sameExpectedReturn(before, next)) {
				lost = next.raw === null ? lostReturn(old) : null;
			} else if (next.raw === null) {
				// A refetch with no return line is indistinguishable from a parser miss: keep the return, record nothing.
				lost = currentReturn(old);
				log("return_lost", { id: row.id });
			} else {
				counts.entries_changed++;
				history(row.id, "return_date_change", { old_status: old.status, new_status: row.status, old_er: before.raw, new_er: next.raw });
			}
		}

		const cols = [...LIST_KEYS, "dci_raw", ...DETAIL_KEYS, "detail_hash", ...LOST_KEYS];
		const lostValues = [lost?.raw ?? null, lost?.earliest ?? null, lost?.latest ?? null, lost?.precision ?? null, lost?.part ?? null];
		stmts.push(
			db
				.prepare(`UPDATE shortages SET ${cols.map((c) => `${c} = ?`).join(", ")}, last_seen_at = ?, missed_runs = 0, listed = 1 WHERE id = ?`)
				.bind(...values, ...lostValues, ctx.now, row.id),
		);
		if (old.listed === 0) history(row.id, "relisted", { new_status: row.status });
	}

	for (const old of stored.values()) {
		if (seen.has(old.id) || old.listed === 0) continue;
		const missed = old.missed_runs + 1;
		if (missed >= DELIST_AFTER_MISSES) {
			counts.entries_delisted++;
			stmts.push(db.prepare("UPDATE shortages SET missed_runs = ?, listed = 0 WHERE id = ?").bind(missed, old.id));
			history(old.id, "delisted", { old_status: old.status });
		} else {
			stmts.push(db.prepare("UPDATE shortages SET missed_runs = ? WHERE id = ?").bind(missed, old.id));
		}
	}

	for (let i = 0; i < stmts.length; i += BATCH_SIZE) await db.batch(stmts.slice(i, i + BATCH_SIZE));
	return counts;
}
