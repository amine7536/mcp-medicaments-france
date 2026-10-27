import * as z from "zod";
import { getMedicines, type MedicineRow } from "../../lib/db";
import { envelope, envelopeSchema, errorResult, loadSourceDates, toolResult } from "../envelope";
import { candidatesSummary, notFound, resolveName } from "../resolve";
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
	Candidates,
	NotFound,
]);

export const outputSchema = envelopeSchema(Data);

export const isMajorTherapeuticInterest: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "is_major_therapeutic_interest",
	title: "Is major therapeutic interest",
	description: `Whether a medicine, given exactly one of its CIS code or its name, is on the BDPM list of medicines of major therapeutic interest (MITM), with its ATC code. ${INFO_ONLY}`,
	inputSchema,
	outputSchema,
	async handler({ db, now }, { cis, name }): Promise<ToolOutcome> {
		const dates = await loadSourceDates(db);
		if ((cis === undefined) === (name === undefined)) return { result: errorResult(EXACTLY_ONE("cis or name"), dates) };
		let medicine: MedicineRow | undefined;
		if (cis !== undefined) {
			medicine = (await getMedicines(db, [cis])).get(cis);
			if (medicine === undefined) return { result: toNotFound(`CIS ${cis}`), cis };
		} else {
			const resolved = await resolveName(db, name as string);
			if (resolved.kind === "candidates") {
				return { result: toolResult(candidatesSummary(name as string), envelope(resolved, dates, now)) };
			}
			if (resolved.kind === "not_found") return { result: toNotFound(`"${name}"`) };
			medicine = resolved.medicine;
		}
		const { cis: code, name: label, is_mitm, atc_code } = medicine;
		const summary = `${label} (CIS ${code}) ${is_mitm ? `is on the BDPM MITM list (ATC ${atc_code})` : "is not on the BDPM MITM list"}. ${MITM_DEFINITION}`;
		const source = `BDPM MITM list, release ${dates.bdpm_release ?? "unknown"}`;
		return { result: toolResult(summary, envelope({ kind: "mitm" as const, cis: code, name: label, is_mitm, atc_code, source }, dates, now)), cis: code };

		function toNotFound(what: string) {
			const out = notFound(what, []);
			return toolResult(out.summary, envelope(out.data, dates, now));
		}
	},
};
