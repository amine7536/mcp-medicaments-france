import manualMatches from "../data/manual_matches.json";
import { insertChunks } from "../lib/db";
import { NUMERIC, tokens } from "../lib/normalize";
import { log } from "./http";

type MatchMethod = "manual" | "dispo" | "exact" | "fuzzy" | "sibling";

export interface ListedShortage {
	id: string;
	ansm_path: string;
	raw_name: string;
	raw_name_norm: string;
}

export interface Medicine {
	cis: string;
	denomination_norm: string;
	form: string | null;
	holder: string | null;
}

interface MatchInputs {
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
	byCis: Map<string, Medicine>;
	/** Name shape (see `nameShape`) to the medicines with that shape. */
	byShape: Map<string, Medicine[]>;
}

interface MatchRow {
	shortage_id: string;
	cis: string;
	method: MatchMethod;
	confidence: number;
	is_best: 0 | 1;
}

/** Entries per strategy (`none` when unmatched), and `sibling`: the number of sibling rows. */
type MatchCounts = Record<MatchMethod | "none", number>;

interface Candidate {
	cis: string;
	confidence: number;
}

const FUZZY_MIN_SCORE = 0.8;
const DOSE = String.raw`\d+(?:\.\d+)? (?:MG|G|MCG|UI)`;
/** The first dose list: two or more doses separated by single spaces, `ET` before the last, each delimited by a space or the string ends. */
const DOSE_LIST = new RegExp(String.raw`(?<=^| )(${DOSE}(?: ${DOSE})*) ET (${DOSE})(?= |$)`);
const ONE_DOSE = new RegExp(DOSE, "g");

/**
 * One name per dose of the first dose list of a normalized name ("X 250 MG 500 MG ET 1 G Y" gives "X 250 MG Y",
 * "X 500 MG Y", "X 1 G Y"); `[]` without a dose list.
 */
export function doseVariants(norm: string): string[] {
	const m = DOSE_LIST.exec(norm);
	if (m === null) return [];
	const doses = [...`${m[1]} ${m[2]}`.matchAll(ONE_DOSE)].map((d) => d[0]);
	const before = norm.slice(0, m.index);
	const after = norm.slice(m.index + m[0].length);
	return doses.map((d) => `${before}${d}${after}`);
}

/** Name tokens with every number replaced by `#`, and the form; null without a form. Medicines differing only by dose share it. */
function nameShape(m: Medicine): string | null {
	if (m.form === null) return null;
	return JSON.stringify([tokens(m.denomination_norm).map((t) => (NUMERIC.test(t) ? "#" : t)), m.form]);
}

const doses = (m: Medicine): string => JSON.stringify(tokens(m.denomination_norm).filter((t) => NUMERIC.test(t)));

function index<T, V>(rows: T[], key: (r: T) => string, value: (r: T) => V): Map<string, V[]> {
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
		byCis: new Map(medicines.map((m) => [m.cis, m])),
		byShape: index(
			medicines.flatMap((m) => {
				const key = nameShape(m);
				return key === null ? [] : [{ key, m }];
			}),
			(r) => r.key,
			(r) => r.m,
		),
	};
}

/** Loads the matching inputs with exactly 3 read queries. */
async function loadMatchInputs(db: D1Database): Promise<MatchInputs> {
	const [shortages, dispo, medicines] = await Promise.all([
		db.prepare("SELECT id, ansm_path, raw_name, raw_name_norm FROM shortages WHERE listed = 1").all<ListedShortage>(),
		db.prepare("SELECT ansm_path, cis FROM bdpm_dispo").all<{ ansm_path: string; cis: string }>(),
		db.prepare("SELECT cis, denomination_norm, form, holder FROM medicines").all<Medicine>(),
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

/** The name and its dose-list variants, for exact matching. */
const names = (s: ListedShortage): string[] => [s.raw_name_norm, ...doseVariants(s.raw_name_norm)];

/** One candidate per CIS, first seen order, highest confidence. */
function union(candidates: Candidate[]): Candidate[] {
	const best = new Map<string, number>();
	for (const c of candidates) best.set(c.cis, Math.max(best.get(c.cis) ?? 0, c.confidence));
	return [...best].map(([cis, confidence]) => ({ cis, confidence }));
}

function exactOne(inputs: MatchInputs, a: string): Candidate[] {
	const prefixed = inputs.medicines
		.filter((m) => a.startsWith(`${m.denomination_norm} `) || m.denomination_norm.startsWith(`${a} `))
		.map((m) => m.cis);
	return known(inputs, [...(inputs.byName.get(a) ?? []), ...prefixed], 0.95);
}

export function matchExact(inputs: MatchInputs, s: ListedShortage): Candidate[] {
	return union(names(s).flatMap((n) => exactOne(inputs, n)));
}

/** Fuzzy match on the name only: dose-list variants would pair near-identical names of other products. */
export function matchFuzzy(inputs: MatchInputs, s: ListedShortage): Candidate[] {
	const ta = tokens(s.raw_name_norm);
	const brand = ta[0];
	if (brand === undefined || brand.length < 3 || /^\d+$/.test(brand) || brand === "SPECIALITES") return [];
	const setA = new Set(ta);
	const numeric = new Set([...setA].filter((t) => NUMERIC.test(t)));
	const out: Candidate[] = [];
	for (const m of inputs.byBrand.get(brand) ?? []) {
		if (!numeric.isSubsetOf(m.tokens)) continue;
		const score = setA.intersection(m.tokens).size / setA.union(m.tokens).size;
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

/**
 * Medicines not in `linked` whose name shape (name and form, numbers aside) is a linked medicine's and whose doses
 * are a linked medicine's, with the highest confidence among the linked medicines of that shape.
 */
function matchSiblings(inputs: MatchInputs, linked: Candidate[]): Candidate[] {
	const linkedCis = new Set(linked.map((c) => c.cis));
	const meds = linked.flatMap((c) => {
		const m = inputs.byCis.get(c.cis);
		return m ? [{ m, confidence: c.confidence }] : [];
	});
	const linkedDoses = new Set(meds.map(({ m }) => doses(m)));
	const byShape = new Map<string, number>();
	for (const { m, confidence } of meds) {
		const key = nameShape(m);
		if (key !== null) byShape.set(key, Math.max(byShape.get(key) ?? 0, confidence));
	}
	const out: Candidate[] = [];
	for (const [key, confidence] of byShape) {
		for (const m of inputs.byShape.get(key) ?? []) {
			if (!linkedCis.has(m.cis) && linkedDoses.has(doses(m))) out.push({ cis: m.cis, confidence });
		}
	}
	return out;
}

/**
 * Rows of the first strategy with candidates, then their sibling rows (not for `manual`); `is_best` on the rows at
 * the strategy's max confidence. Empty when unmatched.
 */
export function matchShortage(inputs: MatchInputs, s: ListedShortage): MatchRow[] {
	for (const [method, strategy] of STRATEGIES) {
		const candidates = strategy(inputs, s);
		if (candidates.length === 0) continue;
		const best = Math.max(...candidates.map((c) => c.confidence));
		const row = (c: Candidate, m: MatchMethod): MatchRow => ({
			shortage_id: s.id,
			cis: c.cis,
			method: m,
			confidence: c.confidence,
			is_best: c.confidence === best ? 1 : 0,
		});
		const siblings = method === "manual" ? [] : matchSiblings(inputs, candidates);
		return [...candidates.map((c) => row(c, method)), ...siblings.map((c) => row(c, "sibling"))];
	}
	return [];
}

/** Recomputes `shortage_matches` for every listed shortage: 3 reads and 1 write batch. */
export async function matchAll(env: Env): Promise<MatchCounts> {
	const db = env.DB;
	const inputs = await loadMatchInputs(db);
	const counts: MatchCounts = { manual: 0, dispo: 0, exact: 0, fuzzy: 0, sibling: 0, none: 0 };
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
		counts.sibling += matched.filter((r) => r.method === "sibling").length;
		rows.push(...matched);
	}
	await db.batch([
		db.prepare("DELETE FROM shortage_matches"),
		...insertChunks(
			db,
			"shortage_matches",
			["shortage_id", "cis", "method", "confidence", "is_best"],
			rows.map((r) => [r.shortage_id, r.cis, r.method, r.confidence, r.is_best]),
		),
	]);
	return counts;
}

/** Runs after a successful diff; returns a fragment for the run message. */
export async function afterIngest(env: Env, _run: { id: number; bootstrap: boolean }): Promise<string> {
	const c = await matchAll(env);
	return `match: manual=${c.manual} dispo=${c.dispo} exact=${c.exact} fuzzy=${c.fuzzy} none=${c.none} sibling=${c.sibling}`;
}
