import * as z from "zod";
import { cisByCip13, currentShortages, getHasOpinions, getMedicineInfo as loadInfo, getMedicines, MARKETED, type MedicineRow } from "../../lib/db";
import { envelopeSchema, loadSourceDates, toolResult } from "../envelope";
import { candidatesData, notFound, resolveName } from "../resolve";
import {
	Candidates,
	Cip13,
	Cis,
	describeShortage,
	type HasOpinion,
	HasOpinions,
	isValidEan13,
	Medicine,
	NotFound,
	outputObject,
	Presentation,
	SafetyInformation,
	type ShortageRow,
	ShortageSummary,
	toShortageSummary,
	utcDate,
} from "../schemas";
import { exactlyOne, INFO_ONLY, type Tool, type ToolOutcome } from "../tool";

/** Presentations listed in the summary; the full list is in the structured content. */
export const SUMMARY_LIMIT = 10;
/** Safety information titles listed in the summary; the full list is in the structured content. */
const SAFETY_SUMMARY_LIMIT = 5;
export const SAFETY_ADVICE = "See the ANSM pages for details; do not stop or change a treatment without asking your doctor or pharmacist.";
export const NO_SAFETY_INFORMATION = "No current ANSM safety information listed in the BDPM.";

export const inputSchema = z.object({
	cis: Cis.optional().describe("8-digit BDPM medicine code (CIS)."),
	cip13: Cip13.refine(isValidEan13, "cip13 is not a valid barcode: its EAN-13 check digit does not match.")
		.optional()
		.describe("13-digit CIP13 code of a box (presentation), as printed on its barcode."),
	name: z.string().min(2).max(100).optional().describe("Medicine name; resolved to one CIS or a list of candidates."),
});

export const Data = z.discriminatedUnion("kind", [
	outputObject({
		kind: z.literal("info"),
		medicine: Medicine,
		presentations: z.array(Presentation),
		prescription_conditions: z.array(z.string()),
		safety_information: z.array(SafetyInformation),
		ansm_shortage: ShortageSummary.nullable(),
		status_conflict: z.string().nullable(),
		/** Absent when the BDPM lists no HAS opinion for the medicine. */
		has_opinions: HasOpinions.optional(),
	}),
	Candidates,
	NotFound,
]);
type Data = z.infer<typeof Data>;

export const outputSchema = envelopeSchema(Data);

const price = (p: Presentation): string => (p.public_price_eur === null ? "price not listed" : `public price ${p.public_price_eur.toFixed(2)} EUR`);
const rates = (p: Presentation): string =>
	p.reimbursement_rates.length === 0 ? "not reimbursed / not listed" : `reimbursed ${p.reimbursement_rates.map((r) => `${r}%`).join(", ")}`;

/**
 * The conflict between an ANSM marketing stop and the BDPM, null when no linked listed entry is a marketing stop or no box is marketed.
 * `entries` are the listed entries linked to the medicine, in shortage order; the first marketing stop is reported.
 */
function statusConflict(entries: readonly ShortageRow[], presentations: readonly Presentation[]): string | null {
	const stop = entries.find((e) => e.status === "arret_commercialisation");
	const marketed = presentations.filter((p) => p.marketing_status === MARKETED).length;
	if (stop === undefined || marketed === 0) return null;
	const since = stop.situation_start === null ? "" : ` since ${stop.situation_start}`;
	return `Status conflict: the BDPM lists ${marketed} marketed box(es), but ANSM lists "${stop.status_raw}" (entry ${stop.id})${since}. The BDPM may not reflect the marketing stop.`;
}

const opinionItems = (items: readonly HasOpinion[]): string => items.map((o) => `${o.value} (${o.motif})`).join(", ");

/** One line: the latest SMR and ASMR opinion of each non-empty kind, the per-indication caveat and the HAS pages of the shown items. */
function hasOpinionsLine(opinions: HasOpinions): string {
	const kinds = (["smr", "asmr"] as const)
		.filter((k) => opinions[k].length > 0)
		.map((k) => `${k.toUpperCase()} of ${(opinions[k][0] as HasOpinion).date}: ${opinionItems(opinions[k])}`);
	const urls = [...new Set([...opinions.smr, ...opinions.asmr].flatMap((o) => (o.ct_url === undefined ? [] : [o.ct_url])))];
	const pages =
		urls.length === 0
			? "the HAS opinion gives the indications (no HAS page URL listed in the BDPM)"
			: `the HAS opinion page gives the indications: ${urls.join(", ")}`;
	return `Latest HAS opinions listed in the BDPM (newer HAS opinions may be missing): ${kinds.join("; ")}. SMR and ASMR values can differ by indication; ${pages}.`;
}

/** The medicine line, the ANSM shortage status and status conflict when any, one line per marketed presentation (at most `SUMMARY_LIMIT`), the BDPM conditions verbatim, then the ANSM safety information titles and links (at most `SAFETY_SUMMARY_LIMIT`), then the HAS opinions when any. */
function infoSummary(
	medicine: Medicine,
	presentations: Presentation[],
	conditions: string[],
	safety: SafetyInformation[],
	shortage: ShortageSummary | null,
	conflict: string | null,
	opinions: HasOpinions | null,
): string {
	const marketed = presentations.filter((p) => p.marketing_status === MARKETED);
	const lines = [`${medicine.name} (CIS ${medicine.cis}): ${marketed.length} marketed box(es) out of ${presentations.length}.`];
	if (shortage !== null) lines.push(`ANSM shortage status: ${describeShortage(shortage)}`);
	if (conflict !== null) lines.push(conflict);
	for (const p of marketed.slice(0, SUMMARY_LIMIT)) lines.push(`- ${p.label} (CIP13 ${p.cip13}): ${price(p)}; ${rates(p)}.`);
	if (marketed.length > SUMMARY_LIMIT) lines.push(`${marketed.length - SUMMARY_LIMIT} more marketed box(es) in the structured content.`);
	lines.push(
		conditions.length === 0
			? "No prescription or dispensing condition listed in the BDPM."
			: `Prescription and dispensing conditions (BDPM): ${conditions.join("; ")}`,
	);
	lines.push(
		safety.length === 0
			? NO_SAFETY_INFORMATION
			: `ANSM safety information (${safety.length}): ${safety
					.slice(0, SAFETY_SUMMARY_LIMIT)
					.map((item) => `${item.title} (${item.url})`)
					.join("; ")}. ${SAFETY_ADVICE}`,
	);
	if (opinions !== null) lines.push(hasOpinionsLine(opinions));
	return lines.join("\n");
}

async function info(db: D1Database, now: Date, m: MedicineRow, cip13: string | null): Promise<{ data: Data; summary: string }> {
	const medicine: Medicine = {
		cis: m.cis,
		name: m.name,
		form: m.form,
		routes: m.routes,
		holder: m.holder,
		marketing_status: m.marketing_status,
		is_mitm: m.is_mitm,
		...(m.amm_status !== null ? { amm_status: m.amm_status } : {}),
		...(m.substances.length > 0 ? { substances: m.substances } : {}),
	};
	const [{ presentations, prescription_conditions, safety_information }, shortages, has_opinions] = await Promise.all([
		loadInfo(db, m.cis, cip13, utcDate(now)),
		currentShortages(db, [m.cis]),
		getHasOpinions(db, m.cis),
	]);
	const linked = shortages.get(m.cis);
	const ansm_shortage = linked === undefined ? null : toShortageSummary(linked.current, now);
	const status_conflict = linked === undefined ? null : statusConflict([linked.current, ...linked.others], presentations);
	return {
		data: {
			kind: "info",
			medicine,
			presentations,
			prescription_conditions,
			safety_information,
			ansm_shortage,
			status_conflict,
			...(has_opinions !== null ? { has_opinions } : {}),
		},
		summary: infoSummary(medicine, presentations, prescription_conditions, safety_information, ansm_shortage, status_conflict, has_opinions),
	};
}

export const getMedicineInfo: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "get_medicine_info",
	title: "Get medicine info",
	description: `Boxes of a medicine in the French public medicines database (BDPM), its prescription and dispensing conditions, its current ANSM safety information and its current ANSM shortage status, given exactly one of its CIS code, a CIP13 barcode or its name. Each box has its CIP13, marketing status, price and reimbursement rate. A name returns one medicine, ranked candidates with their total, holder, marketing, shortage and MITM status and ATC code, or a spelling suggestion when it is misspelled. ${INFO_ONLY}`,
	inputSchema,
	outputSchema,
	async handler({ db, now }, { cis, cip13, name }): Promise<ToolOutcome> {
		const invalid = await exactlyOne(db, { cis, cip13, name });
		if (invalid !== null) return invalid;
		const dates = await loadSourceDates(db);
		if (cip13 !== undefined) {
			const code = await cisByCip13(db, cip13);
			const med = code === null ? undefined : (await getMedicines(db, [code])).get(code);
			const out = med === undefined ? notFound(`CIP13 ${cip13}`, []) : await info(db, now, med, cip13);
			return { result: toolResult(out, dates, now), cis: med ? med.cis : null };
		}
		if (cis !== undefined) {
			const med = (await getMedicines(db, [cis])).get(cis);
			return { result: toolResult(med === undefined ? notFound(`CIS ${cis}`, []) : await info(db, now, med, null), dates, now), cis };
		}
		const resolved = await resolveName(db, name as string);
		if (resolved.kind === "candidates") return { result: toolResult(await candidatesData(db, name as string, resolved), dates, now) };
		if (resolved.kind === "not_found") return { result: toolResult(notFound(`"${name}"`, [], resolved.did_you_mean), dates, now) };
		return { result: toolResult(await info(db, now, resolved.medicine, null), dates, now), cis: resolved.medicine.cis };
	},
};
