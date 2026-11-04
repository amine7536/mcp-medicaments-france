import * as z from "zod";
import { aggregationGroup, getMedicines, type MedicineRow, mitmCodes } from "../../lib/db";
import { envelope, envelopeSchema, errorResult, loadSourceDates, toolResult, UNKNOWN_DATES } from "../envelope";
import { candidatesData, candidatesSummary, notFound, type Resolution, resolveName } from "../resolve";
import { LINKED_LIMIT } from "./getAvailability";
import { Candidates, Cis, NotFound } from "../schemas";
import { EXACTLY_ONE, INFO_ONLY, type Tool, type ToolOutcome } from "../tool";

export const MITM_DEFINITION =
	"MITM (médicaments d'intérêt thérapeutique majeur) are medicines for which an interruption of treatment may endanger the patient's life in the short or medium term, or represents a significant loss of chance.";

export const inputSchema = z.object({
	cis: Cis.optional().describe("8-digit BDPM medicine code (CIS)."),
	name: z.string().min(2).max(100).optional().describe("Medicine name; resolved to one CIS or a list of candidates."),
});

export const Data = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("mitm"),
		cis: Cis,
		name: z.string(),
		is_mitm: z.boolean(),
		atc_code: z.string().nullable(),
		source: z.string(),
	}),
	z.object({
		kind: z.literal("aggregated"),
		query: z.string(),
		total: z.int().min(0),
		is_mitm: z.boolean(),
		atc_code: z.string().nullable(),
		medicines: z.array(z.object({ cis: Cis, name: z.string() })),
		source: z.string(),
	}),
	Candidates,
	NotFound,
]);
type Data = z.infer<typeof Data>;

/**
 * Several medicines match a name: one answer when the match set is complete and every match has the same ATC code
 * (or none is on the MITM list), otherwise the ranked candidates with their MITM status.
 */
async function byCandidates(
	db: D1Database,
	query: string,
	resolved: Extract<Resolution, { kind: "candidates" }>,
	source: string,
): Promise<{ data: Data; summary: string }> {
	const codes = resolved.capped ? new Map<string, string | null>() : await mitmCodes(db, resolved.cis);
	const group = aggregationGroup(
		resolved.capped,
		resolved.cis.map((c) => codes.get(c) ?? null),
	);
	if (group === undefined) {
		const data = await candidatesData(db, resolved);
		return { data, summary: candidatesSummary(query, data) };
	}
	const shown = resolved.cis.slice(0, LINKED_LIMIT);
	const meds = await getMedicines(db, shown);
	const medicines = shown.flatMap((c) => {
		const m = meds.get(c);
		return m ? [{ cis: m.cis, name: m.name }] : [];
	});
	const is_mitm = group !== null;
	const summary = is_mitm
		? `All ${resolved.total} medicines matching "${query}" are on the BDPM MITM list (ATC ${group}). ${MITM_DEFINITION}`
		: `None of the ${resolved.total} medicines matching "${query}" is on the BDPM MITM list. ${MITM_DEFINITION}`;
	return { data: { kind: "aggregated", query, total: resolved.total, is_mitm, atc_code: group, medicines, source }, summary };
}

export const outputSchema = envelopeSchema(Data);

export const isMajorTherapeuticInterest: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "is_major_therapeutic_interest",
	title: "Is major therapeutic interest",
	description: `Whether a medicine, given exactly one of its CIS code or its name, is on the BDPM list of medicines of major therapeutic interest (MITM), with its ATC code. A name whose matches all have the same MITM status and ATC code gets one answer for all of them; otherwise ranked candidates with their total, holder, marketing, shortage and MITM status and ATC code; a misspelled name gets a spelling suggestion. ${INFO_ONLY}`,
	inputSchema,
	outputSchema,
	async handler({ db, now }, { cis, name }): Promise<ToolOutcome> {
		if ((cis === undefined) === (name === undefined)) {
			return { result: errorResult(EXACTLY_ONE("cis or name"), await loadSourceDates(db).catch(() => UNKNOWN_DATES)) };
		}
		const dates = await loadSourceDates(db);
		const source = `BDPM MITM list, release ${dates.bdpm_release ?? "unknown"}`;
		let medicine: MedicineRow | undefined;
		if (cis !== undefined) {
			medicine = (await getMedicines(db, [cis])).get(cis);
			if (medicine === undefined) return { result: toNotFound(`CIS ${cis}`), cis };
		} else {
			const resolved = await resolveName(db, name as string);
			if (resolved.kind === "candidates") {
				const out = await byCandidates(db, name as string, resolved, source);
				return { result: toolResult(out.summary, envelope(out.data, dates, now)) };
			}
			if (resolved.kind === "not_found") return { result: toNotFound(`"${name}"`, resolved.did_you_mean) };
			medicine = resolved.medicine;
		}
		const { cis: code, name: label, is_mitm, atc_code } = medicine;
		const summary = `${label} (CIS ${code}) ${is_mitm ? `is on the BDPM MITM list (ATC ${atc_code})` : "is not on the BDPM MITM list"}. ${MITM_DEFINITION}`;
		return { result: toolResult(summary, envelope({ kind: "mitm" as const, cis: code, name: label, is_mitm, atc_code, source }, dates, now)), cis: code };

		function toNotFound(what: string, did_you_mean: string | null = null) {
			const out = notFound(what, [], did_you_mean);
			return toolResult(out.summary, envelope(out.data, dates, now));
		}
	},
};
