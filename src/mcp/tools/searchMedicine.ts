import * as z from "zod";
import { cisByCip13, currentShortages, getMedicines, MATCH_CAP, searchNames, unmatchedShortages } from "../../lib/db";
import { normalize, tokens } from "../../lib/normalize";
import { envelope, envelopeSchema, loadSourceDates, toolResult } from "../envelope";
import { inShortage } from "../resolve";
import { Cip13, Cis, describeShortage, isValidEan13, ShortageSummary, toShortageSummary } from "../schemas";
import { INFO_ONLY, NOT_FOUND_HINT, type Tool } from "../tool";

export const UNMATCHED_LIMIT = 10;

interface Found {
	/** Ranked CIS. */
	cis: string[];
	total: number;
	capped: boolean;
	fuzzy: boolean;
	did_you_mean: string | null;
}

/** A 13-digit query is a CIP13: the medicine of that presentation, else nothing. Otherwise the ranked name search. */
async function findCis(db: D1Database, query: string): Promise<Found> {
	const q = query.trim();
	if (Cip13.safeParse(q).success) {
		const cis = await cisByCip13(db, q);
		return { cis: cis === null ? [] : [cis], total: cis === null ? 0 : 1, capped: false, fuzzy: false, did_you_mean: null };
	}
	const search = await searchNames(db, query);
	return { cis: search.matches.map((m) => m.cis), total: search.total, capped: search.capped, fuzzy: search.fuzzy, did_you_mean: search.did_you_mean };
}

export const SHORTAGE_NOTE = "No shortage linked to this medicine. Not listed does not mean available.";

export const inputSchema = z.object({
	query: z.string().min(2).max(100).describe("Medicine name (brand) or active substance, e.g. \"doliprane\" or \"amoxicilline\"."),
	only_in_shortage: z.boolean().default(false).describe("Keep only medicines whose current shortage status is rupture or tension."),
	limit: z.int().min(1).max(25).default(10),
});

export const Data = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("results"),
		results: z.array(
			z.object({
				cis: Cis,
				name: z.string(),
				form: z.string().nullable(),
				substances: z.array(z.object({ name: z.string(), dosage: z.string().nullable() })),
				is_mitm: z.boolean(),
				shortage: ShortageSummary.nullable(),
				shortage_note: z.literal(SHORTAGE_NOTE).optional(),
			}),
		),
		unmatched_shortages: z.array(ShortageSummary),
		invalid_cip13: z.literal(true).optional(),
		/** Every match of the query; with `capped`, the best `MATCH_CAP` by relevance and every one in rupture or tension were ranked. */
		total: z.int().min(0),
		capped: z.boolean(),
		/** The results come from the misspelling fallback. */
		fuzzy: z.boolean(),
		did_you_mean: z.string().nullable(),
	}),
]);

export const outputSchema = envelopeSchema(Data);

export const searchMedicine: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "search_medicine",
	title: "Search medicines",
	description: `Search French medicines (BDPM) by name or active substance and show the ANSM shortage linked to each, plus listed shortages not linked to any medicine that match the query. Medicines in rupture or tension come first, then exact brand matches, brand prefixes and active-substance matches; a misspelled name returns the closest names and a spelling suggestion. ${INFO_ONLY}`,
	inputSchema,
	outputSchema,
	async handler({ db, now }, { query, only_in_shortage, limit }) {
		const dates = await loadSourceDates(db);
		const q = query.trim();
		if (Cip13.safeParse(q).success && !isValidEan13(q)) {
			const data = { kind: "results" as const, results: [], unmatched_shortages: [], invalid_cip13: true as const, total: 0, capped: false, fuzzy: false, did_you_mean: null };
			return { result: toolResult(`"${query}" is not a valid CIP13 barcode: its EAN-13 check digit does not match.`, envelope(data, dates, now)) };
		}
		const { cis, total, capped, fuzzy, did_you_mean } = await findCis(db, query);
		const [shortages, unmatched] = await Promise.all([currentShortages(db, cis), unmatchedShortages(db, tokens(normalize(query)), UNMATCHED_LIMIT)]);
		// Over the ranked match set (every match, or the most relevant plus every one in shortage when capped): in-shortage first, stable so rank order holds within, filter, then the limit.
		const picked = cis
			.map((c) => ({ c, s: shortages.get(c)?.current }))
			.filter(({ s }) => !only_in_shortage || inShortage(s?.status))
			.sort((a, b) => Number(inShortage(b.s?.status)) - Number(inShortage(a.s?.status)))
			.slice(0, limit);
		const meds = await getMedicines(
			db,
			picked.map(({ c }) => c),
		);
		const ranked = picked.flatMap(({ c, s }) => {
			const m = meds.get(c);
			return m ? [{ m, s }] : [];
		});
		const results = ranked.map(({ m, s }) => ({
			cis: m.cis,
			name: m.name,
			form: m.form,
			substances: m.substances,
			is_mitm: m.is_mitm,
			shortage: s ? toShortageSummary(s, now) : null,
			...(s ? {} : { shortage_note: SHORTAGE_NOTE }),
		}));
		const unmatched_shortages = unmatched.map((s) => toShortageSummary(s, now));

		const suggestion = did_you_mean === null ? "" : ` Did you mean "${did_you_mean}"?`;
		const lines: string[] = [];
		if (results.length === 0) lines.push(`No medicine found for "${query}". ${NOT_FOUND_HINT}${suggestion}`);
		else {
			const of = capped ? ` (${total} matches: ranked over the ${MATCH_CAP} most relevant and every one in rupture or tension)` : "";
			lines.push(fuzzy ? `No exact match for "${query}".${suggestion} Closest matches:` : `${results.length} medicine(s) found for "${query}"${of}:`);
			for (const r of results) {
				lines.push(`- ${r.name} (CIS ${r.cis})${r.is_mitm ? ", MITM" : ""}: ${r.shortage ? describeShortage(r.shortage) : SHORTAGE_NOTE}`);
			}
		}
		if (unmatched_shortages.length > 0) {
			lines.push("Listed by ANSM but not linked to a medicine above:");
			for (const s of unmatched_shortages) lines.push(`- ${describeShortage(s)}`);
		}
		return { result: toolResult(lines.join("\n"), envelope({ kind: "results" as const, results, unmatched_shortages, total, capped, fuzzy, did_you_mean }, dates, now)) };
	},
};
