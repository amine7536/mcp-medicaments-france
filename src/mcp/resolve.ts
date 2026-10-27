import { getMedicines, type MedicineRow, searchCis, unmatchedShortages } from "../lib/db";
import { normalize, tokens } from "../lib/normalize";
import type * as z from "zod";
import type { NotFound, ShortageRow, ShortageSummary } from "./schemas";
import { NOT_FOUND_HINT } from "./tool";

export const RESOLVE_LIMIT = 10;
export const RELATED_LIMIT = 5;

export type Resolution =
	| { kind: "cis"; medicine: MedicineRow }
	| { kind: "candidates"; candidates: Array<{ cis: string; name: string }> }
	| { kind: "not_found" };

/** Resolves a medicine name to one CIS, several candidates or nothing. */
export async function resolveName(db: D1Database, name: string): Promise<Resolution> {
	const cis = await searchCis(db, name, RESOLVE_LIMIT);
	const meds = await getMedicines(db, cis);
	const found = cis.flatMap((c) => meds.get(c) ?? []);
	if (found.length === 0) return { kind: "not_found" };
	const norm = normalize(name);
	const exact = found.filter((m) => m.denomination_norm === norm);
	const single = found.length === 1 ? found[0] : exact.length === 1 ? exact[0] : undefined;
	if (single) return { kind: "cis", medicine: single };
	return { kind: "candidates", candidates: found.map((m) => ({ cis: m.cis, name: m.name })) };
}

/** The brand token of a normalized name: its first token, when it has at least 3 characters and is not all digits. */
export function brandToken(norm: string): string | null {
	const first = tokens(norm)[0];
	return first !== undefined && first.length >= 3 && !/^\d+$/.test(first) ? first : null;
}

/** Listed, unmatched shortages whose name contains the brand token of `norm`. */
export async function possiblyRelated(db: D1Database, norm: string): Promise<ShortageRow[]> {
	const brand = brandToken(norm);
	return brand === null ? [] : unmatchedShortages(db, [brand], RELATED_LIMIT);
}

export const NO_GUARANTEE = "This does not guarantee availability in your pharmacy.";

export const relatedList = (related: ShortageSummary[]): string => related.map((s) => `${s.name} (${s.status})`).join(", ");

export const candidatesSummary = (name: string): string => `Several medicines match "${name}"; call again with one cis.`;

/** The `not_found` variant and its summary: the spelling hint, then any possibly related entries. */
export function notFound(what: string, related: ShortageSummary[]): { data: z.infer<typeof NotFound>; summary: string } {
	let summary = `No medicine found for ${what}. ${NOT_FOUND_HINT}`;
	if (related.length > 0) summary += ` ANSM lists possibly related entries: ${relatedList(related)}. ${NO_GUARANTEE}`;
	return { data: { kind: "not_found", possibly_related_shortages: related }, summary };
}
