import type { ShortageRow } from "../mcp/schemas";
import { ftsTokens, normalize } from "./normalize";

const SHORTAGE_COLUMNS = [
	"id",
	"ansm_path",
	"raw_name",
	"dci_raw",
	"status",
	"status_raw",
	"scope",
	"scope_raw",
	"expected_return_earliest",
	"expected_return_latest",
	"expected_return_precision",
	"expected_return_part",
	"expected_return_raw",
	"returned_at",
	"situation_start",
	"ansm_updated_at",
	"first_seen_at",
	"listed",
]
	.map((c) => `s.${c}`)
	.join(", ");

/** Best confidence among a shortage's matches, null when unmatched. */
const BEST_CONFIDENCE = "(SELECT MAX(m.confidence) FROM shortage_matches m WHERE m.shortage_id = s.id) AS match_confidence";

const STATUS_RANK =
	"CASE s.status WHEN 'rupture' THEN 0 WHEN 'tension' THEN 1 WHEN 'arret_commercialisation' THEN 2 WHEN 'remise_a_disposition' THEN 3 ELSE 4 END";
const SHORTAGE_ORDER = `${STATUS_RANK}, s.ansm_updated_at DESC, s.id`;

const UNMATCHED = "s.listed = 1 AND NOT EXISTS (SELECT 1 FROM shortage_matches m WHERE m.shortage_id = s.id)";

const all = async <T>(stmt: D1PreparedStatement): Promise<T[]> => (await stmt.all<T>()).results;
const json = (values: readonly string[]): string => JSON.stringify(values);

/** FTS5 query of a free-text name: each `ftsTokens` token as a prefix, implicitly ANDed. Null when there is no token. */
export function ftsQuery(text: string): string | null {
	const toks = ftsTokens(normalize(text));
	return toks.length === 0 ? null : toks.map((t) => `"${t}"*`).join(" ");
}

/** CIS matching `text`, best FTS rank first. */
export async function searchCis(db: D1Database, text: string, limit: number): Promise<string[]> {
	const query = ftsQuery(text);
	if (query === null) return [];
	const rows = await all<{ cis: string }>(
		db.prepare("SELECT cis FROM medicines_fts WHERE medicines_fts MATCH ? ORDER BY rank LIMIT ?").bind(query, limit),
	);
	return rows.map((r) => r.cis);
}

export interface MedicineRow {
	cis: string;
	name: string;
	denomination_norm: string;
	form: string | null;
	is_mitm: boolean;
	atc_code: string | null;
	substances: Array<{ name: string; dosage: string | null }>;
}

/** Medicines by CIS with their substances and MITM status; unknown CIS are absent. */
export async function getMedicines(db: D1Database, cis: readonly string[]): Promise<Map<string, MedicineRow>> {
	const out = new Map<string, MedicineRow>();
	if (cis.length === 0) return out;
	const ids = json(cis);
	const [meds, subs] = await db.batch([
		db
			.prepare(
				"SELECT m.cis, m.denomination AS name, m.denomination_norm, m.form, t.atc_code FROM medicines m LEFT JOIN mitm t ON t.cis = m.cis WHERE m.cis IN (SELECT value FROM json_each(?))",
			)
			.bind(ids),
		db.prepare("SELECT cis, substance_name AS name, dosage FROM substances WHERE cis IN (SELECT value FROM json_each(?)) ORDER BY rowid").bind(ids),
	]);
	for (const m of (meds?.results ?? []) as Array<Omit<MedicineRow, "is_mitm" | "substances">>) {
		out.set(m.cis, { ...m, is_mitm: m.atc_code !== null, substances: [] });
	}
	for (const s of (subs?.results ?? []) as Array<{ cis: string; name: string; dosage: string | null }>) {
		out.get(s.cis)?.substances.push({ name: s.name, dosage: s.dosage });
	}
	return out;
}

export interface CisShortages {
	current: ShortageRow;
	other_shortage_ids: string[];
}

/** Per CIS, the listed shortage linked to it that ranks first (status, then latest update, then id), and the other ones. */
export async function currentShortages(db: D1Database, cis: readonly string[]): Promise<Map<string, CisShortages>> {
	const out = new Map<string, CisShortages>();
	if (cis.length === 0) return out;
	const rows = await all<ShortageRow & { cis: string }>(
		db
			.prepare(
				`SELECT sm.cis, sm.confidence AS match_confidence, ${SHORTAGE_COLUMNS} FROM shortage_matches sm JOIN shortages s ON s.id = sm.shortage_id WHERE s.listed = 1 AND sm.cis IN (SELECT value FROM json_each(?)) ORDER BY sm.cis, ${SHORTAGE_ORDER}`,
			)
			.bind(json(cis)),
	);
	for (const { cis: c, ...row } of rows) {
		const entry = out.get(c);
		if (entry) entry.other_shortage_ids.push(row.id);
		else out.set(c, { current: row, other_shortage_ids: [] });
	}
	return out;
}

/** Listed, unmatched shortages whose normalized name contains every token. */
export async function unmatchedShortages(db: D1Database, toks: readonly string[], limit: number): Promise<ShortageRow[]> {
	if (toks.length === 0) return [];
	return all<ShortageRow>(
		db
			.prepare(
				`SELECT ${SHORTAGE_COLUMNS}, NULL AS match_confidence FROM shortages s WHERE ${UNMATCHED} AND NOT EXISTS (SELECT 1 FROM json_each(?) t WHERE instr(s.raw_name_norm, t.value) = 0) ORDER BY ${SHORTAGE_ORDER} LIMIT ?`,
			)
			.bind(json(toks), limit),
	);
}

export interface LinkedMedicine {
	cis: string;
	name: string;
	match_confidence: number;
	is_best: number;
}

/** A shortage by id (listed or not) with every medicine linked to it, by CIS. */
export async function getShortage(db: D1Database, id: string): Promise<{ shortage: ShortageRow; links: LinkedMedicine[] } | null> {
	const [s, links] = await db.batch([
		db.prepare(`SELECT ${SHORTAGE_COLUMNS}, ${BEST_CONFIDENCE} FROM shortages s WHERE s.id = ?`).bind(id),
		db
			.prepare(
				"SELECT sm.cis, m.denomination AS name, sm.confidence AS match_confidence, sm.is_best FROM shortage_matches sm JOIN medicines m ON m.cis = sm.cis WHERE sm.shortage_id = ? ORDER BY sm.cis",
			)
			.bind(id),
	]);
	const shortage = s?.results[0] as ShortageRow | undefined;
	return shortage ? { shortage, links: (links?.results ?? []) as LinkedMedicine[] } : null;
}

export interface HistoryRow {
	change_type: "new" | "status_change" | "return_date_change" | "delisted" | "relisted";
	old_status: string | null;
	new_status: string | null;
	old_expected_return: string | null;
	new_expected_return: string | null;
	detected_at: string;
}

/** Change log of a shortage, oldest first. */
export function getHistory(db: D1Database, shortageId: string): Promise<HistoryRow[]> {
	return all<HistoryRow>(
		db
			.prepare(
				"SELECT change_type, old_status, new_status, old_expected_return, new_expected_return, detected_at FROM status_history WHERE shortage_id = ? ORDER BY detected_at, id",
			)
			.bind(shortageId),
	);
}

export interface ShortageFilter {
	statuses: readonly string[];
	/** Accepted `scope` values; null for any. */
	scopes: readonly string[] | null;
	/** Normalized therapeutic area; null for any. */
	area: string | null;
	updatedSince: string | null;
	limit: number;
	offset: number;
}

/** Listed shortages matching the filter, latest update first, with the total and the best-match CIS of each. */
export async function listShortages(
	db: D1Database,
	f: ShortageFilter,
): Promise<{ total: number; items: Array<ShortageRow & { cis: string[] }> }> {
	const where = `s.listed = 1 AND s.status IN (SELECT value FROM json_each(?1))
		AND (?2 IS NULL OR s.scope IN (SELECT value FROM json_each(?2)))
		AND (?3 IS NULL OR instr(s.therapeutic_areas_norm, ?3) > 0)
		AND (?4 IS NULL OR s.ansm_updated_at >= ?4)`;
	const params = [json(f.statuses), f.scopes === null ? null : json(f.scopes), f.area, f.updatedSince];
	const [total, page] = await db.batch([
		db.prepare(`SELECT COUNT(*) AS n FROM shortages s WHERE ${where}`).bind(...params),
		db
			.prepare(
				`SELECT ${SHORTAGE_COLUMNS}, ${BEST_CONFIDENCE}, (SELECT json_group_array(cis) FROM (SELECT m.cis FROM shortage_matches m WHERE m.shortage_id = s.id AND m.is_best = 1 ORDER BY m.cis)) AS best_cis FROM shortages s WHERE ${where} ORDER BY s.ansm_updated_at DESC, s.id LIMIT ?5 OFFSET ?6`,
			)
			.bind(...params, f.limit, f.offset),
	]);
	const items = ((page?.results ?? []) as Array<ShortageRow & { best_cis: string }>).map(({ best_cis, ...row }) => ({
		...row,
		cis: JSON.parse(best_cis) as string[],
	}));
	return { total: (total?.results[0] as { n: number } | undefined)?.n ?? 0, items };
}

export interface ChangeRow extends HistoryRow {
	id: number;
	shortage_id: string;
	name: string;
	ansm_path: string;
}

/** Changes detected since `since`: counts per type over the window, and the latest items of the given types. */
export async function recentChanges(
	db: D1Database,
	since: string,
	types: readonly string[],
	limit: number,
): Promise<{ counts: Map<string, number>; items: ChangeRow[] }> {
	const [counts, items] = await db.batch([
		db.prepare("SELECT change_type, COUNT(*) AS n FROM status_history WHERE detected_at >= ? GROUP BY change_type").bind(since),
		db
			.prepare(
				"SELECT h.id, h.shortage_id, h.change_type, h.old_status, h.new_status, h.old_expected_return, h.new_expected_return, h.detected_at, s.raw_name AS name, s.ansm_path FROM status_history h JOIN shortages s ON s.id = h.shortage_id WHERE h.detected_at >= ? AND h.change_type IN (SELECT value FROM json_each(?)) ORDER BY h.detected_at DESC, h.id DESC LIMIT ?",
			)
			.bind(since, json(types), limit),
	]);
	return {
		counts: new Map(((counts?.results ?? []) as Array<{ change_type: string; n: number }>).map((r) => [r.change_type, r.n])),
		items: (items?.results ?? []) as ChangeRow[],
	};
}

/** The `marketing_status` of a presentation that is on the market. */
export const MARKETED = "Déclaration de commercialisation";

export interface MedicineIdentity {
	cis: string;
	name: string;
	form: string | null;
	routes: string | null;
	holder: string | null;
	marketing_status: string | null;
	is_mitm: boolean;
}

export interface PresentationRow {
	cip13: string;
	cip7: string | null;
	label: string;
	admin_status: string | null;
	marketing_status: string | null;
	declared_at: string | null;
	hospital_approval: boolean | null;
	reimbursement_rates: number[];
	price_eur: number | null;
	public_price_eur: number | null;
	dispensing_fee_eur: number | null;
	reimbursement_indications: string | null;
}

/** The CIS of the presentation with this CIP13, or null. */
export async function cisByCip13(db: D1Database, cip13: string): Promise<string | null> {
	return db.prepare("SELECT cis FROM presentations WHERE cip13 = ?").bind(cip13).first<string>("cis");
}

/** A medicine's identity and every presentation of it, marketed ones first, then by label; null for an unknown CIS. */
export async function getMedicineInfo(
	db: D1Database,
	cis: string,
): Promise<{ medicine: MedicineIdentity; presentations: PresentationRow[] } | null> {
	const [med, pres] = await db.batch([
		db
			.prepare(
				"SELECT m.cis, m.denomination AS name, m.form, m.routes, m.holder, m.marketing_status, t.cis IS NOT NULL AS is_mitm FROM medicines m LEFT JOIN mitm t ON t.cis = m.cis WHERE m.cis = ?",
			)
			.bind(cis),
		db
			.prepare(
				"SELECT cip13, cip7, label, admin_status, marketing_status, declared_at, hospital_approval, reimbursement_rates, price_eur, public_price_eur, dispensing_fee_eur, reimbursement_indications FROM presentations WHERE cis = ? ORDER BY marketing_status IS NOT ?, label, cip13",
			)
			.bind(cis, MARKETED),
	]);
	const m = med?.results[0] as (Omit<MedicineIdentity, "is_mitm"> & { is_mitm: number }) | undefined;
	if (m === undefined) return null;
	type Raw = Omit<PresentationRow, "hospital_approval" | "reimbursement_rates"> & { hospital_approval: number | null; reimbursement_rates: string | null };
	const presentations = ((pres?.results ?? []) as Raw[]).map((p) => ({
		...p,
		hospital_approval: p.hospital_approval === null ? null : p.hospital_approval === 1,
		reimbursement_rates: p.reimbursement_rates === null ? [] : (JSON.parse(p.reimbursement_rates) as number[]),
	}));
	return { medicine: { ...m, is_mitm: m.is_mitm === 1 }, presentations };
}
