import { currentShortages, getMedicines, MATCH_CAP, type MedicineRow, type NameMatch, orderedMedicines, relatedShortages, searchNames } from "../lib/db";
import { normalize, NUMERIC, tokens } from "../lib/normalize";
import type * as z from "zod";
import type { Candidates, NotFound, ShortageRow, ShortageSummary } from "./schemas";
import { NOT_FOUND_HINT } from "./tool";

export const RESOLVE_LIMIT = 10;
const RELATED_LIMIT = 5;

export type Resolution =
	| { kind: "cis"; medicine: MedicineRow }
	/**
	 * Every ranked CIS of the exact match set (at most `MATCH_CAP`), best matches first; `best` the best matches and
	 * `splitsDose` whether the query's number splits the matches across doses, both over the fetched matches.
	 */
	| { kind: "candidates"; total: number; capped: boolean; cis: string[]; best: string[]; splitsDose: boolean }
	| { kind: "not_found"; did_you_mean: string | null };

/** The query's tokens from its first number after its first token to its end; null when it has no such number. */
function doseTail(query: string): string[] | null {
	const toks = tokens(normalize(query));
	const at = toks.findIndex((t, i) => i > 0 && NUMERIC.test(t));
	return at < 0 ? null : toks.slice(at);
}

/** A name's tokens from its first number; empty when it has none. */
function fromFirstNumber(norm: string): string[] {
	const toks = tokens(norm);
	const at = toks.findIndex((t) => NUMERIC.test(t));
	return at < 0 ? [] : toks.slice(at);
}

/**
 * The CIS of the matches naming the query's brand and dose, in the given order: same first token as the query (tier 0),
 * and tokens from the first number starting with the query's, a trailing number not continued by a 3-digit group
 * (`10` is not `10 000 UI`).
 */
export function bestMatches(query: string, matches: readonly NameMatch[]): string[] {
	const tail = doseTail(query);
	if (tail === null) return [];
	const endsWithNumber = NUMERIC.test(tail[tail.length - 1] as string);
	return matches
		.filter((m) => {
			if (m.tier !== 0) return false;
			const dose = fromFirstNumber(m.denomination_norm);
			if (!tail.every((t, i) => dose[i] === t)) return false;
			return !(endsWithNumber && /^\d{3}$/.test(dose[tail.length] ?? ""));
		})
		.map((m) => m.cis);
}

/** Whether the query has a number and the matches do not all have the same first dose (first number and the token after it). */
export function splitsDose(query: string, matches: readonly NameMatch[]): boolean {
	if (doseTail(query) === null) return false;
	return new Set(matches.map((m) => fromFirstNumber(m.denomination_norm).slice(0, 2).join(" "))).size > 1;
}

/** Resolves a medicine name to one CIS, ranked candidates, or nothing (with a spelling suggestion). Misspellings never resolve. */
export async function resolveName(db: D1Database, name: string, cap: number = MATCH_CAP): Promise<Resolution> {
	const search = await searchNames(db, name, cap);
	if (search.fuzzy || search.matches.length === 0) return { kind: "not_found", did_you_mean: search.did_you_mean };
	const norm = normalize(name);
	const exact = search.matches.filter((m) => m.denomination_norm === norm);
	const single = search.matches.length === 1 ? search.matches[0] : exact.length === 1 ? exact[0] : undefined;
	if (single) {
		const medicine = (await getMedicines(db, [single.cis])).get(single.cis);
		if (medicine) return { kind: "cis", medicine };
	}
	const best = bestMatches(name, search.matches);
	const isBest = new Set(best);
	const rest = search.matches.flatMap((m) => (isBest.has(m.cis) ? [] : [m.cis]));
	return { kind: "candidates", total: search.total, capped: search.capped, cis: [...best, ...rest], best, splitsDose: splitsDose(name, search.matches) };
}

export const inShortage = (status: string | undefined): boolean => status === "rupture" || status === "tension";

/**
 * The `candidates` data of a resolution and its summary: the first `RESOLVE_LIMIT`, in rupture or tension first and otherwise
 * in resolution order, with holder, marketing and shortage status, MITM status and ATC code, `best_match` on the best matches
 * shown and `best_match_total` when there is one. The count in rupture or tension across all matches is in the summary only.
 */
export async function candidatesData(
	db: D1Database,
	query: string,
	resolved: Extract<Resolution, { kind: "candidates" }>,
): Promise<{ data: z.infer<typeof Candidates>; summary: string }> {
	const shortages = await currentShortages(db, resolved.cis);
	const isInShortage = (c: string): boolean => inShortage(shortages.get(c)?.current.status);
	const shown = resolved.cis.toSorted((a, b) => Number(isInShortage(b)) - Number(isInShortage(a))).slice(0, RESOLVE_LIMIT);
	const best = new Set(resolved.best);
	const candidates = (await orderedMedicines(db, shown)).map((m) => ({
		cis: m.cis,
		name: m.name,
		holder: m.holder,
		marketing_status: m.marketing_status,
		shortage_status: shortages.get(m.cis)?.current.status ?? null,
		is_mitm: m.is_mitm,
		atc_code: m.atc_code,
		...(best.has(m.cis) ? { best_match: true as const } : {}),
	}));
	const data = {
		kind: "candidates" as const,
		total: resolved.total,
		capped: resolved.capped,
		candidates,
		...(resolved.best.length > 0 ? { best_match_total: resolved.best.length } : {}),
	};
	return { data, summary: candidatesSummary(query, data.total, resolved.cis.filter(isInShortage).length, data.best_match_total ?? 0) };
}

/** The brand token of a normalized name: its first token, when it has at least 3 characters and is not all digits. */
function brandToken(norm: string): string | null {
	const first = tokens(norm)[0];
	return first !== undefined && first.length >= 3 && !/^\d+$/.test(first) ? first : null;
}

/** Listed shortages, linked to other medicines or to none, whose name contains the brand token of `norm`. */
export async function possiblyRelated(db: D1Database, norm: string): Promise<ShortageRow[]> {
	const brand = brandToken(norm);
	return brand === null ? [] : relatedShortages(db, [brand], RELATED_LIMIT);
}

export const NO_GUARANTEE = "This does not guarantee availability in your pharmacy.";

export const relatedList = (related: ShortageSummary[]): string => related.map((s) => `${s.name} (${s.status})`).join(", ");

export const matchCount = (name: string, total: number): string => `${total} ${total === 1 ? "medicine matches" : "medicines match"} "${name}"`;

export const candidatesSummary = (name: string, total: number, inShortageTotal: number, bestMatchTotal: number): string =>
	(inShortageTotal > 0
		? `${matchCount(name, total)}, ${inShortageTotal} of them in rupture or tension and listed first; call again with one cis.`
		: `${matchCount(name, total)}; call again with one cis.`) +
	(bestMatchTotal > 0 ? ` \`best_match\` flags ${bestMatchTotal} of them as matching the name and dose.` : "");

/** The `not_found` variant and its summary: the spelling suggestion or hint, then any possibly related entries. */
export function notFound(
	what: string,
	related: ShortageSummary[],
	did_you_mean: string | null = null,
): { data: z.infer<typeof NotFound>; summary: string } {
	let summary = `No medicine found for ${what}. ${NOT_FOUND_HINT}${did_you_mean === null ? "" : ` Did you mean "${did_you_mean}"?`}`;
	if (related.length > 0) summary += ` ANSM lists possibly related entries: ${relatedList(related)}. ${NO_GUARANTEE}`;
	return { data: { kind: "not_found", possibly_related_shortages: related, did_you_mean }, summary };
}
