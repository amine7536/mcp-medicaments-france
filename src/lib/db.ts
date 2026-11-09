import type { Presentation, SafetyInformation, ShortageRow } from "../mcp/schemas";
import { ftsTokens, normalize, tokens } from "./normalize";

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

/** INSERT statements of `rows` (values in `columns` order), `floor(100 / columns)` rows each: D1 binds at most 100 parameters per query. */
export function insertChunks(db: D1Database, table: string, columns: readonly string[], rows: readonly (readonly unknown[])[]): D1PreparedStatement[] {
	const perInsert = Math.floor(100 / columns.length);
	const tuple = `(${columns.map(() => "?").join(", ")})`;
	const stmts: D1PreparedStatement[] = [];
	for (let i = 0; i < rows.length; i += perInsert) {
		const chunk = rows.slice(i, i + perInsert);
		stmts.push(db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => tuple).join(", ")}`).bind(...chunk.flat()));
	}
	return stmts;
}

/** Best confidence among a shortage's matches, null when unmatched. */
const BEST_CONFIDENCE = "(SELECT MAX(m.confidence) FROM shortage_matches m WHERE m.shortage_id = s.id) AS match_confidence";

const STATUS_RANK =
	"CASE s.status WHEN 'rupture' THEN 0 WHEN 'tension' THEN 1 WHEN 'arret_commercialisation' THEN 2 WHEN 'remise_a_disposition' THEN 3 ELSE 4 END";
const SHORTAGE_ORDER = `${STATUS_RANK}, s.ansm_updated_at DESC, s.id`;

const UNMATCHED = "s.listed = 1 AND NOT EXISTS (SELECT 1 FROM shortage_matches m WHERE m.shortage_id = s.id)";

const all = async <T>(stmt: D1PreparedStatement): Promise<T[]> => (await stmt.all<T>()).results;
const json = (values: readonly string[]): string => JSON.stringify(values);

/** FTS5 query of a free-text name: each `ftsTokens` token as a prefix, implicitly ANDed. Null when there is no token. */
function ftsQuery(text: string): string | null {
	const toks = ftsTokens(normalize(text));
	return toks.length === 0 ? null : toks.map((t) => `"${t}"*`).join(" ");
}

/** Exact matches fetched per name query; `total` still counts every match. */
export const MATCH_CAP = 1000;
/** Trigram rows fetched for the misspelling fallback. */
const FUZZY_ROWS = 50;
/** Minimum share of the query trigrams a fallback row must contain. */
const FUZZY_MIN_SIMILARITY = 0.5;
/** The BDPM marketing status of a medicine on the market. */
export const MEDICINE_MARKETED = "Commercialisée";

interface NameRow {
	cis: string;
	denomination_norm: string;
	marketing_status: string | null;
}

export interface NameMatch extends NameRow {
	tier: 0 | 1 | 2;
}

interface NameSearch {
	/** Ranked: exact matches, or fallback matches when nothing matches exactly. */
	matches: NameMatch[];
	/** Every exact match (not only the fetched ones), or the number of kept fallback matches. */
	total: number;
	/** More exact matches than `MATCH_CAP`: only the fetched ones are ranked. */
	capped: boolean;
	/** The matches come from the trigram fallback. */
	fuzzy: boolean;
	/** The name token closest to a misspelled query; fallback only. */
	did_you_mean: string | null;
}

const EMPTY_SEARCH: NameSearch = { matches: [], total: 0, capped: false, fuzzy: false, did_you_mean: null };

/** 0: same brand token as the query; 1: brand prefix of or prefixed by the query; 2: any other match (other tokens, substances). */
function tier(q: string | undefined, name: string): 0 | 1 | 2 {
	const b = tokens(name)[0];
	if (q === undefined || b === undefined) return 2;
	if (b === q) return 0;
	if (b.startsWith(q) || (b.length >= 5 && q.startsWith(b))) return 1;
	return 2;
}

/** Ranks name matches by tier, then marketed first, then shorter name, then CIS. */
export function rankMatches(query: string, rows: readonly NameRow[]): NameMatch[] {
	const q = tokens(normalize(query))[0];
	return rows
		.map((r) => ({ ...r, tier: tier(q, r.denomination_norm) }))
		.sort(
			(a, b) =>
				a.tier - b.tier ||
				Number(b.marketing_status === MEDICINE_MARKETED) - Number(a.marketing_status === MEDICINE_MARKETED) ||
				a.denomination_norm.length - b.denomination_norm.length ||
				a.cis.localeCompare(b.cis),
		);
}

/** The distinct 3-character substrings of the query tokens of 3+ characters, in order of appearance. */
export function queryTrigrams(norm: string): string[] {
	const out = new Set<string>();
	for (const t of tokens(norm)) for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
	return [...out];
}

const shared = (trigrams: readonly string[], text: string): number => trigrams.filter((t) => text.includes(t)).length;

interface FuzzyRow extends NameRow {
	substances_norm: string | null;
}

/**
 * Keeps the fallback rows sharing at least `FUZZY_MIN_SIMILARITY` of the query trigrams in their name and substances,
 * closest first (then in the given bm25 order), and the token of the closest row sharing the most trigrams.
 */
export function rankFuzzy(trigrams: readonly string[], rows: readonly FuzzyRow[]): { matches: NameMatch[]; did_you_mean: string | null } {
	if (trigrams.length === 0) return { matches: [], did_you_mean: null };
	const kept = rows
		.map((r, rank) => ({ r, rank, similarity: shared(trigrams, `${r.denomination_norm} ${r.substances_norm ?? ""}`) / trigrams.length }))
		.filter((x) => x.similarity >= FUZZY_MIN_SIMILARITY)
		.sort((a, b) => b.similarity - a.similarity || a.rank - b.rank);
	const best = kept[0];
	if (best === undefined) return { matches: [], did_you_mean: null };
	let suggestion: string | null = null;
	let top = 0;
	for (const t of [...tokens(best.r.denomination_norm), ...tokens(best.r.substances_norm ?? "")]) {
		const n = shared(trigrams, t);
		if (n > top) [suggestion, top] = [t, n];
	}
	return {
		matches: kept.map(({ r }) => ({ cis: r.cis, denomination_norm: r.denomination_norm, marketing_status: r.marketing_status, tier: 2 as const })),
		did_you_mean: suggestion,
	};
}

/** Trigram fallback over `medicines_trgm`, ranked by `rankFuzzy`. */
async function fuzzySearch(db: D1Database, norm: string): Promise<NameSearch> {
	const trigrams = queryTrigrams(norm);
	if (trigrams.length === 0) return EMPTY_SEARCH;
	const rows = await all<FuzzyRow>(
		db
			.prepare(
				"SELECT f.cis, f.denomination_norm, f.substances_norm, m.marketing_status FROM medicines_trgm f JOIN medicines m ON m.cis = f.cis WHERE medicines_trgm MATCH ?1 ORDER BY bm25(medicines_trgm) LIMIT ?2",
			)
			.bind(trigrams.map((t) => `"${t}"`).join(" OR "), FUZZY_ROWS),
	);
	const { matches, did_you_mean } = rankFuzzy(trigrams, rows);
	return matches.length === 0 ? EMPTY_SEARCH : { matches, total: matches.length, capped: false, fuzzy: true, did_you_mean };
}

/** Exact name matches currently linked to a listed entry in rupture or tension, whatever their FTS rank. */
export async function inShortageMatches(db: D1Database, ftsMatch: string): Promise<NameRow[]> {
	return all<NameRow>(
		db
			.prepare(
				"SELECT DISTINCT f.cis, f.denomination_norm, m.marketing_status FROM medicines_fts f JOIN medicines m ON m.cis = f.cis JOIN shortage_matches sm ON sm.cis = f.cis JOIN shortages s ON s.id = sm.shortage_id WHERE medicines_fts MATCH ?1 AND s.listed = 1 AND s.status IN ('rupture', 'tension')",
			)
			.bind(ftsMatch),
	);
}

/**
 * The current listed entry shared by every medicine of a complete match set: its id, `null` when none is linked to a
 * listed entry, `undefined` when the set is capped, empty or split across entries.
 */
export function aggregationGroup(capped: boolean, entryIds: ReadonlyArray<string | null>): string | null | undefined {
	if (capped || entryIds.length === 0) return undefined;
	const groups = new Set(entryIds);
	return groups.size === 1 ? (entryIds[0] as string | null) : undefined;
}

/**
 * Name search: the exact FTS matches ranked, or the trigram fallback when nothing matches exactly. Beyond `cap`
 * matches, the best `cap` by FTS rank are kept, plus every match in rupture or tension, so no shortage is dropped.
 */
export async function searchNames(db: D1Database, text: string, cap: number = MATCH_CAP): Promise<NameSearch> {
	const query = ftsQuery(text);
	if (query === null) return EMPTY_SEARCH;
	const [rows, count] = await db.batch([
		db
			.prepare(
				"SELECT f.cis, f.denomination_norm, m.marketing_status FROM medicines_fts f JOIN medicines m ON m.cis = f.cis WHERE medicines_fts MATCH ?1 ORDER BY f.rank LIMIT ?2",
			)
			.bind(query, cap),
		db.prepare("SELECT COUNT(*) AS n FROM medicines_fts WHERE medicines_fts MATCH ?1").bind(query),
	]);
	const fetched = (rows?.results ?? []) as NameRow[];
	const total = Number((count?.results[0] as { n: number } | undefined)?.n ?? 0);
	if (total === 0) return fuzzySearch(db, normalize(text));
	const capped = total > fetched.length;
	const found = capped ? [...new Map([...fetched, ...(await inShortageMatches(db, query))].map((r) => [r.cis, r])).values()] : fetched;
	return { matches: rankMatches(text, found), total, capped, fuzzy: false, did_you_mean: null };
}

export interface MedicineRow {
	cis: string;
	name: string;
	denomination_norm: string;
	form: string | null;
	routes: string | null;
	holder: string | null;
	marketing_status: string | null;
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
				"SELECT m.cis, m.denomination AS name, m.denomination_norm, m.form, m.routes, m.holder, m.marketing_status, t.atc_code FROM medicines m LEFT JOIN mitm t ON t.cis = m.cis WHERE m.cis IN (SELECT value FROM json_each(?))",
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

/** The medicines of a CIS list, in that order; unknown CIS are skipped. */
export async function orderedMedicines(db: D1Database, cis: readonly string[]): Promise<MedicineRow[]> {
	const meds = await getMedicines(db, cis);
	return cis.flatMap((c) => meds.get(c) ?? []);
}

/** ATC code per CIS (null when the CIS is not on the MITM list); unknown CIS are absent. */
export async function mitmCodes(db: D1Database, cis: readonly string[]): Promise<Map<string, string | null>> {
	if (cis.length === 0) return new Map();
	const rows = await all<{ cis: string; atc_code: string | null }>(
		db.prepare("SELECT m.cis, t.atc_code FROM medicines m LEFT JOIN mitm t ON t.cis = m.cis WHERE m.cis IN (SELECT value FROM json_each(?))").bind(json(cis)),
	);
	return new Map(rows.map((r) => [r.cis, r.atc_code]));
}

interface CisShortages {
	current: ShortageRow;
	/** The other listed shortages linked to the CIS, in the same order. */
	others: ShortageRow[];
	other_shortage_ids: string[];
}

/** Per CIS, the listed shortage linked to it that ranks first (status, then latest update, then id), and the other ones in that order. */
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
		if (entry) {
			entry.others.push(row);
			entry.other_shortage_ids.push(row.id);
		} else out.set(c, { current: row, others: [], other_shortage_ids: [] });
	}
	return out;
}

/** Listed shortages, matched or not, whose normalized name contains every token. */
export async function relatedShortages(db: D1Database, toks: readonly string[], limit: number): Promise<ShortageRow[]> {
	if (toks.length === 0) return [];
	return all<ShortageRow>(
		db
			.prepare(
				`SELECT ${SHORTAGE_COLUMNS}, NULL AS match_confidence FROM shortages s WHERE s.listed = 1 AND NOT EXISTS (SELECT 1 FROM json_each(?) t WHERE instr(s.raw_name_norm, t.value) = 0) ORDER BY ${SHORTAGE_ORDER} LIMIT ?`,
			)
			.bind(json(toks), limit),
	);
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

interface LinkedMedicine {
	cis: string;
	name: string;
	match_confidence: number;
}

/** A shortage by id (listed or not) with every medicine linked to it, by CIS. */
export async function getShortage(db: D1Database, id: string): Promise<{ shortage: ShortageRow; links: LinkedMedicine[] } | null> {
	const [s, links] = await db.batch([
		db.prepare(`SELECT ${SHORTAGE_COLUMNS}, ${BEST_CONFIDENCE} FROM shortages s WHERE s.id = ?`).bind(id),
		db
			.prepare(
				"SELECT sm.cis, m.denomination AS name, sm.confidence AS match_confidence FROM shortage_matches sm JOIN medicines m ON m.cis = sm.cis WHERE sm.shortage_id = ? ORDER BY sm.cis",
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

interface ShortageFilter {
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

/** Distinct therapeutic area labels of listed shortages, sorted in French order. */
export async function listedAreas(db: D1Database): Promise<string[]> {
	const rows = await all<{ therapeutic_areas: string | null }>(db.prepare("SELECT DISTINCT therapeutic_areas FROM shortages WHERE listed = 1"));
	const labels = new Set(rows.flatMap((r) => (r.therapeutic_areas ?? "").split(", ").map((l) => l.trim())).filter((l) => l !== ""));
	return [...labels].sort((a, b) => a.localeCompare(b, "fr"));
}

/** Whether a listed shortage's normalized therapeutic areas contain `areaNorm`, the area predicate of `listShortages`. */
export async function areaKnown(db: D1Database, areaNorm: string): Promise<boolean> {
	const row = await db.prepare("SELECT 1 AS known FROM shortages WHERE listed = 1 AND instr(therapeutic_areas_norm, ?) > 0 LIMIT 1").bind(areaNorm).first();
	return row !== null;
}

interface ChangeRow extends HistoryRow {
	id: number;
	shortage_id: string;
	name: string;
	ansm_path: string;
}

/**
 * Changes of the given types detected since `since`: counts per type over the window and the latest items,
 * with the end of the first successful ANSM run (`tracking_since`, null when none): no change is recorded before it.
 */
export async function recentChanges(
	db: D1Database,
	since: string,
	types: readonly string[],
	limit: number,
): Promise<{ counts: Map<string, number>; items: ChangeRow[]; tracking_since: string | null }> {
	const [counts, items, tracking] = await db.batch([
		db
			.prepare("SELECT change_type, COUNT(*) AS n FROM status_history WHERE detected_at >= ? AND change_type IN (SELECT value FROM json_each(?)) GROUP BY change_type")
			.bind(since, json(types)),
		db
			.prepare(
				"SELECT h.id, h.shortage_id, h.change_type, h.old_status, h.new_status, h.old_expected_return, h.new_expected_return, h.detected_at, s.raw_name AS name, s.ansm_path FROM status_history h JOIN shortages s ON s.id = h.shortage_id WHERE h.detected_at >= ? AND h.change_type IN (SELECT value FROM json_each(?)) ORDER BY h.detected_at DESC, h.id DESC LIMIT ?",
			)
			.bind(since, json(types), limit),
		db.prepare("SELECT MIN(finished_at) AS first_ok FROM ingest_runs WHERE source = 'ansm' AND status = 'ok'"),
	]);
	return {
		counts: new Map(((counts?.results ?? []) as Array<{ change_type: string; n: number }>).map((r) => [r.change_type, r.n])),
		items: (items?.results ?? []) as ChangeRow[],
		tracking_since: (tracking?.results[0] as { first_ok: string | null } | undefined)?.first_ok ?? null,
	};
}

/** The `marketing_status` of a presentation that is on the market. */
export const MARKETED = "Déclaration de commercialisation";

/** The CIS of the presentation with this CIP13, or null. */
export async function cisByCip13(db: D1Database, cip13: string): Promise<string | null> {
	return db.prepare("SELECT cis FROM presentations WHERE cip13 = ?").bind(cip13).first<string>("cis");
}

interface MedicineInfo {
	presentations: Presentation[];
	prescription_conditions: string[];
	safety_information: SafetyInformation[];
}

/**
 * Every presentation of a CIS (the one with `cip13` first when given, then marketed ones, then by label),
 * its BDPM prescription and dispensing conditions, verbatim, in source order, and its ANSM safety information
 * active on `today` (`YYYY-MM-DD`, `starts_on <= today <= ends_on`), latest start first.
 */
export async function getMedicineInfo(db: D1Database, cis: string, cip13: string | null, today: string): Promise<MedicineInfo> {
	type Raw = Omit<Presentation, "hospital_approval" | "reimbursement_rates"> & { hospital_approval: number | null; reimbursement_rates: string | null };
	const [presentations, conditions, safety] = await db.batch([
		db
			.prepare(
				"SELECT cip13, cip7, label, admin_status, marketing_status, declared_at, hospital_approval, reimbursement_rates, price_eur, public_price_eur, dispensing_fee_eur, reimbursement_indications FROM presentations WHERE cis = ? ORDER BY cip13 IS NOT ?, marketing_status IS NOT ?, label, cip13",
			)
			.bind(cis, cip13, MARKETED),
		db.prepare("SELECT condition FROM prescription_conditions WHERE cis = ? ORDER BY position").bind(cis),
		db
			.prepare(
				"SELECT title, url, starts_on, ends_on FROM safety_information WHERE cis = ? AND starts_on <= ? AND ends_on >= ? ORDER BY starts_on DESC, title, url",
			)
			.bind(cis, today, today),
	]);
	return {
		presentations: ((presentations?.results ?? []) as Raw[]).map((p) => ({
			...p,
			hospital_approval: p.hospital_approval === null ? null : p.hospital_approval === 1,
			reimbursement_rates: p.reimbursement_rates === null ? [] : (JSON.parse(p.reimbursement_rates) as number[]),
		})),
		prescription_conditions: ((conditions?.results ?? []) as Array<{ condition: string }>).map((r) => r.condition),
		safety_information: (safety?.results ?? []) as SafetyInformation[],
	};
}
