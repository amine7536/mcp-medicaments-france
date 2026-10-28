import * as z from "zod";
import { cisByCip13, getMedicineInfo as loadInfo, getMedicines, MARKETED, type MedicineRow } from "../../lib/db";
import { envelope, envelopeSchema, errorResult, loadSourceDates, type SourceDates, toolResult, UNKNOWN_DATES } from "../envelope";
import { candidatesSummary, notFound, resolveName } from "../resolve";
import { Candidates, Cip13, Cis, Medicine, NotFound, Presentation } from "../schemas";
import { EXACTLY_ONE, INFO_ONLY, type Tool, type ToolOutcome } from "../tool";

/** Presentations listed in the summary; the full list is in the structured content. */
export const SUMMARY_LIMIT = 10;

export const inputSchema = z.object({
	cis: Cis.optional().describe("8-digit BDPM medicine code (CIS)."),
	cip13: Cip13.optional().describe("13-digit CIP13 code of a box (presentation), as printed on its barcode."),
	name: z.string().min(2).max(100).optional().describe("Medicine name; resolved to one CIS or a list of candidates."),
});

export const Data = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("info"), medicine: Medicine, presentations: z.array(Presentation), prescription_conditions: z.array(z.string()) }),
	Candidates,
	NotFound,
]);
type Data = z.infer<typeof Data>;

export const outputSchema = envelopeSchema(Data);

const price = (p: Presentation): string => (p.public_price_eur === null ? "price not listed" : `public price ${p.public_price_eur.toFixed(2)} EUR`);
const rates = (p: Presentation): string =>
	p.reimbursement_rates.length === 0 ? "not reimbursed / not listed" : `reimbursed ${p.reimbursement_rates.map((r) => `${r}%`).join(", ")}`;

/** The medicine line, one line per marketed presentation (at most `SUMMARY_LIMIT`), then the BDPM conditions verbatim. */
export function infoSummary(medicine: Medicine, presentations: Presentation[], conditions: string[]): string {
	const marketed = presentations.filter((p) => p.marketing_status === MARKETED);
	const lines = [`${medicine.name} (CIS ${medicine.cis}): ${marketed.length} marketed box(es) out of ${presentations.length}.`];
	for (const p of marketed.slice(0, SUMMARY_LIMIT)) lines.push(`- ${p.label} (CIP13 ${p.cip13}): ${price(p)}; ${rates(p)}.`);
	if (marketed.length > SUMMARY_LIMIT) lines.push(`${marketed.length - SUMMARY_LIMIT} more marketed box(es) in the structured content.`);
	lines.push(
		conditions.length === 0
			? "No prescription or dispensing condition listed in the BDPM."
			: `Prescription and dispensing conditions (BDPM): ${conditions.join("; ")}`,
	);
	return lines.join("\n");
}

async function info(db: D1Database, m: MedicineRow, cip13: string | null): Promise<{ data: Data; summary: string }> {
	const medicine: Medicine = {
		cis: m.cis,
		name: m.name,
		form: m.form,
		routes: m.routes,
		holder: m.holder,
		marketing_status: m.marketing_status,
		is_mitm: m.is_mitm,
	};
	const { presentations, prescription_conditions } = await loadInfo(db, m.cis, cip13);
	return {
		data: { kind: "info", medicine, presentations, prescription_conditions },
		summary: infoSummary(medicine, presentations, prescription_conditions),
	};
}

const result = (dates: SourceDates, now: Date, out: { data: Data; summary: string }) => toolResult(out.summary, envelope(out.data, dates, now));

export const getMedicineInfo: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "get_medicine_info",
	title: "Get medicine info",
	description: `Boxes of a medicine in the French public medicines database (BDPM) and its prescription and dispensing conditions, given exactly one of its CIS code, a CIP13 barcode or its name. Each box has its CIP13, marketing status, price and reimbursement rate. ${INFO_ONLY}`,
	inputSchema,
	outputSchema,
	async handler({ db, now }, { cis, cip13, name }): Promise<ToolOutcome> {
		if ([cis, cip13, name].filter((a) => a !== undefined).length !== 1) {
			return { result: errorResult(EXACTLY_ONE("cis, cip13 or name"), await loadSourceDates(db).catch(() => UNKNOWN_DATES)) };
		}
		const dates = await loadSourceDates(db);
		if (cip13 !== undefined) {
			const code = await cisByCip13(db, cip13);
			const med = code === null ? undefined : (await getMedicines(db, [code])).get(code);
			const out = med === undefined ? notFound(`CIP13 ${cip13}`, []) : await info(db, med, cip13);
			return { result: result(dates, now, out), cis: med ? med.cis : null };
		}
		if (cis !== undefined) {
			const med = (await getMedicines(db, [cis])).get(cis);
			return { result: result(dates, now, med === undefined ? notFound(`CIS ${cis}`, []) : await info(db, med, null)), cis };
		}
		const resolved = await resolveName(db, name as string);
		if (resolved.kind === "candidates") return { result: result(dates, now, { data: resolved, summary: candidatesSummary(name as string) }) };
		if (resolved.kind === "not_found") return { result: result(dates, now, notFound(`"${name}"`, [])) };
		return { result: result(dates, now, await info(db, resolved.medicine, null)), cis: resolved.medicine.cis };
	},
};
