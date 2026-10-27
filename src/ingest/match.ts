import manualMatches from "../data/manual_matches.json";
import { tokens } from "../lib/normalize";
import { log } from "./http";

export type MatchMethod = "manual" | "dispo" | "exact" | "fuzzy";

export interface ListedShortage {
	id: string;
	ansm_path: string;
	raw_name: string;
	raw_name_norm: string;
}

export interface Medicine {
	cis: string;
	denomination_norm: string;
}

export interface MatchInputs {
	shortages: ListedShortage[];
	medicines: Medicine[];
	/** CIS of the `medicines` table; candidates outside it are dropped. */
	known: Set<string>;
	/** `denomination_norm` to CIS. */
	byName: Map<string, string[]>;
	/** `bdpm_dispo.ansm_path` to CIS. */
	dispo: Map<string, string[]>;
	/** First name token to the medicines with that first token, with their token sets. */
	byBrand: Map<string, Array<{ cis: string; brand: string; tokens: Set<string> }>>;
	/** ANSM data-id to CIS overrides. */
	manual: Record<string, string[]>;
}

export interface MatchRow {
	shortage_id: string;
	cis: string;
	method: MatchMethod;
	confidence: number;
	is_best: 0 | 1;
}

export type MatchCounts = Record<MatchMethod | "none", number>;

interface Candidate {
	cis: string;
	confidence: number;
}

const ROWS_PER_INSERT = 20; // 5 columns x 20 rows = 100 bound parameters (limit 100)
const NUMERIC = /^\d+(\.\d+)?$/;
const FUZZY_MIN_SCORE = 0.8;

/** Groups `rows` by `key`, keeping `value` of each row. */
function index<T>(rows: T[], key: (r: T) => string, value: (r: T) => string): Map<string, string[]> {
	return new Map([...Map.groupBy(rows, key)].map(([k, group]) => [k, group.map(value)]));
}

/** Builds the in-memory inputs; `manual` defaults to the bundled overrides. */
export function buildMatchInputs(
	shortages: ListedShortage[],
	dispoRows: Array<{ ansm_path: string; cis: string }>,
	medicines: Medicine[],
	manual: Record<string, string[]> = manualMatches as Record<string, string[]>,
): MatchInputs {
	return {
		shortages,
		medicines,
		known: new Set(medicines.map((m) => m.cis)),
		byName: index(medicines, (m) => m.denomination_norm, (m) => m.cis),
		dispo: index(dispoRows, (r) => r.ansm_path, (r) => r.cis),
		byBrand: Map.groupBy(
			medicines.map((m) => {
				const t = tokens(m.denomination_norm);
				return { cis: m.cis, brand: t[0] ?? "", tokens: new Set(t) };
			}),
			(m) => m.brand,
		),
		manual,
	};
}

/** Loads the matching inputs with exactly 3 read queries. */
export async function loadMatchInputs(db: D1Database): Promise<MatchInputs> {
	const [shortages, dispo, medicines] = await Promise.all([
		db.prepare("SELECT id, ansm_path, raw_name, raw_name_norm FROM shortages WHERE listed = 1").all<ListedShortage>(),
		db.prepare("SELECT ansm_path, cis FROM bdpm_dispo").all<{ ansm_path: string; cis: string }>(),
		db.prepare("SELECT cis, denomination_norm FROM medicines").all<Medicine>(),
	]);
	return buildMatchInputs(shortages.results, dispo.results, medicines.results);
}

/** Distinct known CIS with one confidence. */
function known(inputs: MatchInputs, cis: Iterable<string>, confidence: number): Candidate[] {
	return [...new Set(cis)].filter((c) => inputs.known.has(c)).map((c) => ({ cis: c, confidence }));
}

export function matchManual(inputs: MatchInputs, s: ListedShortage): Candidate[] {
	return known(inputs, inputs.manual[s.id] ?? [], 1);
}

export function matchDispo(inputs: MatchInputs, s: ListedShortage): Candidate[] {
	return known(inputs, inputs.dispo.get(s.ansm_path) ?? [], 1);
}

export function matchExact(inputs: MatchInputs, s: ListedShortage): Candidate[] {
	const a = s.raw_name_norm;
	const prefixed = inputs.medicines
		.filter((m) => a.startsWith(`${m.denomination_norm} `) || m.denomination_norm.startsWith(`${a} `))
		.map((m) => m.cis);
	return known(inputs, [...(inputs.byName.get(a) ?? []), ...prefixed], 0.95);
}

export function matchFuzzy(inputs: MatchInputs, s: ListedShortage): Candidate[] {
	const ta = tokens(s.raw_name_norm);
	const brand = ta[0];
	if (brand === undefined || brand.length < 3 || /^\d+$/.test(brand) || brand === "SPECIALITES") return [];
	const setA = new Set(ta);
	const numeric = [...setA].filter((t) => NUMERIC.test(t));
	const out: Candidate[] = [];
	for (const m of inputs.byBrand.get(brand) ?? []) {
		if (!numeric.every((t) => m.tokens.has(t))) continue;
		const shared = [...setA].filter((t) => m.tokens.has(t)).length;
		const score = shared / (setA.size + m.tokens.size - shared);
		if (score >= FUZZY_MIN_SCORE) out.push({ cis: m.cis, confidence: Math.round(score * 100) / 100 });
	}
	return out;
}

const STRATEGIES: Array<[MatchMethod, (inputs: MatchInputs, s: ListedShortage) => Candidate[]]> = [
	["manual", matchManual],
	["dispo", matchDispo],
	["exact", matchExact],
	["fuzzy", matchFuzzy],
];

/** Rows of the first strategy with candidates; `is_best` on the max-confidence rows. Empty when unmatched. */
export function matchShortage(inputs: MatchInputs, s: ListedShortage): MatchRow[] {
	for (const [method, strategy] of STRATEGIES) {
		const candidates = strategy(inputs, s);
		if (candidates.length === 0) continue;
		const best = Math.max(...candidates.map((c) => c.confidence));
		return candidates.map((c) => ({
			shortage_id: s.id,
			cis: c.cis,
			method,
			confidence: c.confidence,
			is_best: c.confidence === best ? 1 : 0,
		}));
	}
	return [];
}

/** Recomputes `shortage_matches` for every listed shortage: 3 reads and 1 write batch. */
export async function matchAll(env: Env): Promise<MatchCounts> {
	const db = env.DB;
	const inputs = await loadMatchInputs(db);
	const counts: MatchCounts = { manual: 0, dispo: 0, exact: 0, fuzzy: 0, none: 0 };
	const rows: MatchRow[] = [];
	for (const s of inputs.shortages) {
		const matched = matchShortage(inputs, s);
		const first = matched[0];
		if (first === undefined) {
			counts.none++;
			log("unmatched", { id: s.id, raw_name: s.raw_name });
			continue;
		}
		counts[first.method]++;
		rows.push(...matched);
	}
	const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM shortage_matches")];
	for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
		const chunk = rows.slice(i, i + ROWS_PER_INSERT);
		stmts.push(
			db
				.prepare(
					"INSERT INTO shortage_matches (shortage_id, cis, method, confidence, is_best) VALUES " +
						chunk.map(() => "(?, ?, ?, ?, ?)").join(", "),
				)
				.bind(...chunk.flatMap((r) => [r.shortage_id, r.cis, r.method, r.confidence, r.is_best])),
		);
	}
	await db.batch(stmts);
	return counts;
}
