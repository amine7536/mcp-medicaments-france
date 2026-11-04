import { currentShortages, getMedicines, MATCH_CAP, type MedicineRow, relatedShortages, searchNames } from "../lib/db";
import { normalize, tokens } from "../lib/normalize";
import type * as z from "zod";
import type { Candidates, NotFound, ShortageRow, ShortageSummary } from "./schemas";
import { NOT_FOUND_HINT } from "./tool";

export const RESOLVE_LIMIT = 10;
export const RELATED_LIMIT = 5;

export type Resolution =
	| { kind: "cis"; medicine: MedicineRow }
	/** Every ranked CIS of the exact match set (at most `MATCH_CAP`). */
	| { kind: "candidates"; total: number; capped: boolean; cis: string[] }
	| { kind: "not_found"; did_you_mean: string | null };

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
	return { kind: "candidates", total: search.total, capped: search.capped, cis: search.matches.map((m) => m.cis) };
}

export const inShortage = (status: string | undefined): boolean => status === "rupture" || status === "tension";

/** The `candidates` data of a resolution: the first `RESOLVE_LIMIT`, in rupture or tension first and otherwise in rank order, with holder, marketing and shortage status, MITM status and ATC code. */
export async function candidatesData(db: D1Database, resolved: Extract<Resolution, { kind: "candidates" }>): Promise<z.infer<typeof Candidates>> {
	const shortages = await currentShortages(db, resolved.cis);
	const isInShortage = (c: string): boolean => inShortage(shortages.get(c)?.current.status);
	const shown = resolved.cis.toSorted((a, b) => Number(isInShortage(b)) - Number(isInShortage(a))).slice(0, RESOLVE_LIMIT);
	const meds = await getMedicines(db, shown);
	const candidates = shown.flatMap((c) => {
		const m = meds.get(c);
		return m
			? [
					{
						cis: m.cis,
						name: m.name,
						holder: m.holder,
						marketing_status: m.marketing_status,
						shortage_status: shortages.get(c)?.current.status ?? null,
						is_mitm: m.is_mitm,
						atc_code: m.atc_code,
					},
				]
			: [];
	});
	return { kind: "candidates", total: resolved.total, capped: resolved.capped, in_shortage_total: resolved.cis.filter(isInShortage).length, candidates };
}

/** The brand token of a normalized name: its first token, when it has at least 3 characters and is not all digits. */
export function brandToken(norm: string): string | null {
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

export const candidatesSummary = (name: string, { total, in_shortage_total }: z.infer<typeof Candidates>): string =>
	in_shortage_total > 0
		? `${total} medicines match "${name}", ${in_shortage_total} of them in rupture or tension and listed first; call again with one cis.`
		: `${total} medicines match "${name}"; call again with one cis.`;

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
