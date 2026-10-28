import * as z from "zod";
import { cisByCip13, currentShortages, getMedicines, searchCis, unmatchedShortages } from "../../lib/db";
import { normalize, tokens } from "../../lib/normalize";
import { envelope, envelopeSchema, loadSourceDates, toolResult } from "../envelope";
import { Cip13, Cis, describeShortage, ShortageSummary, toShortageSummary } from "../schemas";
import { INFO_ONLY, NOT_FOUND_HINT, type Tool } from "../tool";

export const SEARCH_LIMIT = 100;
export const UNMATCHED_LIMIT = 10;

/** A 13-digit query is a CIP13: the medicine of that presentation, else nothing. Otherwise the full-text search. */
async function findCis(db: D1Database, query: string): Promise<string[]> {
	const q = query.trim();
	if (Cip13.safeParse(q).success) {
		const cis = await cisByCip13(db, q);
		return cis === null ? [] : [cis];
	}
	return searchCis(db, query, SEARCH_LIMIT);
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
	}),
]);

export const outputSchema = envelopeSchema(Data);

const inShortage = (status: string | undefined): boolean => status === "rupture" || status === "tension";

export const searchMedicine: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "search_medicine",
	title: "Search medicines",
	description: `Search French medicines (BDPM) by name or active substance and show the ANSM shortage linked to each, plus listed shortages not linked to any medicine that match the query. Medicines in rupture or tension come first. ${INFO_ONLY}`,
	inputSchema,
	outputSchema,
	async handler({ db, now }, { query, only_in_shortage, limit }) {
		const dates = await loadSourceDates(db);
		const cis = await findCis(db, query);
		const [meds, shortages, unmatched] = await Promise.all([
			getMedicines(db, cis),
			currentShortages(db, cis),
			unmatchedShortages(db, tokens(normalize(query)), UNMATCHED_LIMIT),
		]);
		const ranked = cis
			.flatMap((c) => meds.get(c) ?? [])
			.map((m) => ({ m, s: shortages.get(m.cis)?.current }))
			.filter(({ s }) => !only_in_shortage || inShortage(s?.status))
			.sort((a, b) => Number(inShortage(b.s?.status)) - Number(inShortage(a.s?.status)))
			.slice(0, limit);
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

		const lines: string[] = [];
		if (results.length === 0) lines.push(`No medicine found for "${query}". ${NOT_FOUND_HINT}`);
		else {
			lines.push(`${results.length} medicine(s) found for "${query}":`);
			for (const r of results) {
				lines.push(`- ${r.name} (CIS ${r.cis})${r.is_mitm ? ", MITM" : ""}: ${r.shortage ? describeShortage(r.shortage) : SHORTAGE_NOTE}`);
			}
		}
		if (unmatched_shortages.length > 0) {
			lines.push("Listed by ANSM but not linked to a medicine above:");
			for (const s of unmatched_shortages) lines.push(`- ${describeShortage(s)}`);
		}
		return { result: toolResult(lines.join("\n"), envelope({ kind: "results" as const, results, unmatched_shortages }, dates, now)) };
	},
};
