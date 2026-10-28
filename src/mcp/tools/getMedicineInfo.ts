import * as z from "zod";
import { cisByCip13, getMedicineInfo as loadMedicineInfo, MARKETED, type MedicineIdentity, type PresentationRow } from "../../lib/db";
import { envelope, envelopeSchema, errorResult, loadSourceDates, type SourceDates, toolResult, UNKNOWN_DATES } from "../envelope";
import { candidatesSummary, notFound, resolveName } from "../resolve";
import { Candidates, Cip13, Cis, NotFound } from "../schemas";
import { EXACTLY_ONE, INFO_ONLY, type Tool, type ToolOutcome } from "../tool";

/** Presentations listed in the summary; the full list is in the structured content. */
export const SUMMARY_LIMIT = 10;

export const inputSchema = z.object({
	cis: Cis.optional().describe("8-digit BDPM medicine code (CIS)."),
	cip13: Cip13.optional().describe("13-digit CIP13 code of a box (presentation), as printed on its barcode."),
	name: z.string().min(2).max(100).optional().describe("Medicine name; resolved to one CIS or a list of candidates."),
});

const Medicine = z.object({
	cis: Cis,
	name: z.string(),
	form: z.string().nullable(),
	routes: z.string().nullable(),
	holder: z.string().nullable(),
	marketing_status: z.string().nullable(),
	is_mitm: z.boolean(),
});

const Presentation = z.object({
	cip13: Cip13,
	cip7: z.string().nullable(),
	label: z.string(),
	admin_status: z.string().nullable(),
	marketing_status: z.string().nullable(),
	declared_at: z.iso.date().nullable(),
	hospital_approval: z.boolean().nullable(),
	reimbursement_rates: z.array(z.int().min(0)),
	price_eur: z.number().nullable(),
	public_price_eur: z.number().nullable(),
	dispensing_fee_eur: z.number().nullable(),
	reimbursement_indications: z.string().nullable(),
});

export const Data = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("info"), medicine: Medicine, presentations: z.array(Presentation) }),
	Candidates,
	NotFound,
]);
type Data = z.infer<typeof Data>;

export const outputSchema = envelopeSchema(Data);

const price = (p: PresentationRow): string => (p.public_price_eur === null ? "price not listed" : `public price ${p.public_price_eur.toFixed(2)} EUR`);
const rates = (p: PresentationRow): string =>
	p.reimbursement_rates.length === 0 ? "not reimbursed / not listed" : `reimbursed ${p.reimbursement_rates.map((r) => `${r}%`).join(", ")}`;

/** The medicine line, then one line per marketed presentation (at most `SUMMARY_LIMIT`). */
export function infoSummary(medicine: MedicineIdentity, presentations: PresentationRow[]): string {
	const marketed = presentations.filter((p) => p.marketing_status === MARKETED);
	const lines = [`${medicine.name} (CIS ${medicine.cis}): ${marketed.length} marketed presentation(s) out of ${presentations.length}.`];
	for (const p of marketed.slice(0, SUMMARY_LIMIT)) lines.push(`- ${p.label} (CIP13 ${p.cip13}): ${price(p)}; ${rates(p)}.`);
	if (marketed.length > SUMMARY_LIMIT) lines.push(`${marketed.length - SUMMARY_LIMIT} more marketed presentation(s) in the structured content.`);
	return lines.join("\n");
}

async function info(db: D1Database, cis: string, cip13: string | null): Promise<{ data: Data; summary: string } | null> {
	const found = await loadMedicineInfo(db, cis);
	if (found === null) return null;
	const { medicine } = found;
	let { presentations } = found;
	const match = cip13 === null ? -1 : presentations.findIndex((p) => p.cip13 === cip13);
	if (match > 0) presentations = [presentations[match] as PresentationRow, ...presentations.filter((_, i) => i !== match)];
	return { data: { kind: "info", medicine, presentations }, summary: infoSummary(medicine, presentations) };
}

const result = (dates: SourceDates, now: Date, out: { data: Data; summary: string }) => toolResult(out.summary, envelope(out.data, dates, now));

export const getMedicineInfo: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "get_medicine_info",
	title: "Get medicine info",
	description: `Look up a medicine's official reference information from the French public medicines database (BDPM): boxes with their CIP13 barcode, marketing status, price and reimbursement rate. ${INFO_ONLY}`,
	inputSchema,
	outputSchema,
	async handler({ db, now }, { cis, cip13, name }): Promise<ToolOutcome> {
		if ([cis, cip13, name].filter((a) => a !== undefined).length !== 1) {
			return { result: errorResult(EXACTLY_ONE("cis, cip13 or name"), await loadSourceDates(db).catch(() => UNKNOWN_DATES)) };
		}
		const dates = await loadSourceDates(db);
		if (cip13 !== undefined) {
			const code = await cisByCip13(db, cip13);
			const out = code === null ? null : await info(db, code, cip13);
			return { result: result(dates, now, out ?? notFound(`CIP13 ${cip13}`, [])), cis: out ? code : null };
		}
		if (cis !== undefined) {
			return { result: result(dates, now, (await info(db, cis, null)) ?? notFound(`CIS ${cis}`, [])), cis };
		}
		const resolved = await resolveName(db, name as string);
		if (resolved.kind === "candidates") return { result: result(dates, now, { data: resolved, summary: candidatesSummary(name as string) }) };
		if (resolved.kind === "not_found") return { result: result(dates, now, notFound(`"${name}"`, [])) };
		const code = resolved.medicine.cis;
		return { result: result(dates, now, (await info(db, code, null)) ?? notFound(`"${name}"`, [])), cis: code };
	},
};
