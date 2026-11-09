import * as z from "zod";
import { aggregationGroup, currentShortages, getHistory, getMedicines, getShortage, type HistoryRow, type MedicineRow, orderedMedicines } from "../../lib/db";
import { normalize } from "../../lib/normalize";
import { envelopeSchema, loadSourceDates, toolResult } from "../envelope";
import { candidatesData, NO_GUARANTEE, notFound, possiblyRelated, type Resolution, relatedList, resolveName } from "../resolve";
import { Candidates, Cis, describeShortage, NotFound, outputObject, type ShortageRow, ShortageSummary, Status, toShortageSummary } from "../schemas";
import { exactlyOne, INFO_ONLY, type Tool, type ToolOutcome } from "../tool";

export const NOT_LISTED = `No shortage currently listed by ANSM for this medicine. ${NO_GUARANTEE}`;

/** Linked medicines returned per shortage; the full count is in `linked_medicines_total`. */
export const LINKED_LIMIT = 20;

export const inputSchema = z.object({
	cis: Cis.optional().describe("8-digit BDPM medicine code (CIS)."),
	shortage_id: z
		.string()
		.regex(/^\d{1,6}$/, "shortage_id must be the numeric id of an ANSM shortage entry (1 to 6 digits).")
		.optional().describe("ANSM shortage id: the numeric id of an ANSM shortage entry."),
	name: z.string().min(2).max(100).optional().describe("Medicine name; resolved to one CIS or a list of candidates."),
});

const HistoryItem = z.discriminatedUnion("change", [
	outputObject({ date: z.iso.date(), change: z.literal("new"), status: Status.nullable() }),
	outputObject({ date: z.iso.date(), change: z.literal("status_change"), from: Status.nullable(), to: Status.nullable() }),
	outputObject({ date: z.iso.date(), change: z.literal("return_date_change"), from_raw: z.string().nullable(), to_raw: z.string().nullable() }),
	outputObject({ date: z.iso.date(), change: z.literal("delisted") }),
	outputObject({ date: z.iso.date(), change: z.literal("relisted") }),
]);
type HistoryItem = z.infer<typeof HistoryItem>;

const StatusSinceSource = z.enum(["ansm", "service"]);

export const Data = z.discriminatedUnion("kind", [
	outputObject({
		kind: z.literal("availability"),
		medicine: outputObject({ cis: Cis, name: z.string(), is_mitm: z.boolean() }).nullable(),
		linked_medicines: z.array(outputObject({ cis: Cis, name: z.string(), match_confidence: z.number() })),
		linked_medicines_total: z.int().min(0),
		listed: z.boolean(),
		shortage: ShortageSummary.nullable(),
		first_seen_at: z.iso.date().nullable(),
		status_since: z.iso.date().nullable(),
		status_since_source: StatusSinceSource.nullable(),
		history: z.array(HistoryItem),
		other_shortage_ids: z.array(z.string()),
		possibly_related_shortages: z.array(ShortageSummary),
	}),
	outputObject({
		kind: z.literal("aggregated"),
		query: z.string(),
		total: z.int().min(0),
		shortage: ShortageSummary.nullable(),
		medicines: z.array(outputObject({ cis: Cis, name: z.string() })),
		/** With no shared entry: listed entries whose name contains the query's brand token, matched or not. */
		possibly_related_shortages: z.array(ShortageSummary),
	}),
	Candidates,
	NotFound,
]);
type Data = z.infer<typeof Data>;

export const outputSchema = envelopeSchema(Data);

function toHistoryItem(h: HistoryRow): HistoryItem {
	const date = h.detected_at.slice(0, 10);
	const status = (s: string | null) => s as z.infer<typeof Status> | null;
	switch (h.change_type) {
		case "new":
			return { date, change: "new", status: status(h.new_status) };
		case "status_change":
			return { date, change: "status_change", from: status(h.old_status), to: status(h.new_status) };
		case "return_date_change":
			return { date, change: "return_date_change", from_raw: h.old_expected_return, to_raw: h.new_expected_return };
		default:
			return { date, change: h.change_type };
	}
}

/**
 * Date (`YYYY-MM-DD`) the shortage entered its current status, and who dated it: the latest status change or relisting
 * detected by this service, else ANSM's situation start, else the day this service first saw the entry.
 */
export function statusSince(history: HistoryRow[], shortage: ShortageRow): { date: string; source: z.infer<typeof StatusSinceSource> } {
	const last = history.findLast((h) => h.change_type === "status_change" || h.change_type === "relisted");
	if (last !== undefined) return { date: last.detected_at.slice(0, 10), source: "service" };
	if (shortage.situation_start !== null) return { date: shortage.situation_start.slice(0, 10), source: "ansm" };
	return { date: shortage.first_seen_at.slice(0, 10), source: "service" };
}

const medicineLabel = (m: Pick<MedicineRow, "cis" | "name" | "is_mitm">): string => `${m.name} (CIS ${m.cis}${m.is_mitm ? ", MITM" : ""})`;

async function availability(
	db: D1Database,
	now: Date,
	medicine: MedicineRow | null,
	shortage: ShortageRow | null,
	other_shortage_ids: string[],
): Promise<{ data: Data; summary: string }> {
	const med = medicine && { cis: medicine.cis, name: medicine.name, is_mitm: medicine.is_mitm };
	if (shortage === null) {
		const related = medicine ? (await possiblyRelated(db, medicine.denomination_norm)).map((s) => toShortageSummary(s, now)) : [];
		const sentence =
			related.length === 0
				? NOT_LISTED
				: `No shortage is linked to this medicine with certainty, but ANSM lists possibly related entries: ${relatedList(related)}. ${NO_GUARANTEE}`;
		return {
			data: {
				kind: "availability",
				medicine: med,
				linked_medicines: [],
				linked_medicines_total: 0,
				listed: false,
				shortage: null,
				first_seen_at: null,
				status_since: null,
				status_since_source: null,
				history: [],
				other_shortage_ids: [],
				possibly_related_shortages: related,
			},
			summary: `${med ? `${medicineLabel(med)}: ` : ""}${sentence}`,
		};
	}
	const [history, detail] = await Promise.all([getHistory(db, shortage.id), getShortage(db, shortage.id)]);
	const summary = toShortageSummary(shortage, now);
	const since = statusSince(history, shortage);
	const listed = shortage.listed === 1;
	const links = detail?.links ?? [];
	const entry =
		links.length === 0
			? `ANSM entry ${shortage.id}, not linked to a BDPM medicine`
			: `ANSM entry ${shortage.id}, linked to ${links.length} BDPM medicine(s)`;
	const lines = [
		`${med ? medicineLabel(med) : entry}: ANSM lists ${describeShortage(summary)}`,
		`In this status since ${since.date} (${since.source === "ansm" ? "ANSM situation date" : "detected by this service"}).${listed ? "" : " This entry is no longer listed by ANSM."}`,
	];
	if (other_shortage_ids.length > 0) lines.push(`Other listed ANSM entries for this medicine: ${other_shortage_ids.join(", ")}.`);
	return {
		data: {
			kind: "availability",
			medicine: med,
			linked_medicines: links.slice(0, LINKED_LIMIT).map(({ cis, name, match_confidence }) => ({ cis, name, match_confidence })),
			linked_medicines_total: links.length,
			listed,
			shortage: summary,
			first_seen_at: shortage.first_seen_at.slice(0, 10),
			status_since: since.date,
			status_since_source: since.source,
			history: history.map(toHistoryItem),
			other_shortage_ids,
			possibly_related_shortages: [],
		},
		summary: lines.join("\n"),
	};
}

async function byCis(db: D1Database, now: Date, medicine: MedicineRow) {
	const current = (await currentShortages(db, [medicine.cis])).get(medicine.cis);
	return availability(db, now, medicine, current?.current ?? null, current?.other_shortage_ids ?? []);
}

async function byShortageId(db: D1Database, now: Date, id: string): Promise<{ data: Data; summary: string }> {
	const found = await getShortage(db, id);
	if (found === null) {
		return {
			data: { kind: "not_found", possibly_related_shortages: [], did_you_mean: null },
			summary: `No ANSM shortage entry with id "${id}". Use search_medicine or list_current_shortages to find an entry.`,
		};
	}
	return availability(db, now, null, found.shortage, []);
}

/**
 * Several medicines match a name: one answer when every match shares the same current listed entry (or none is
 * listed) and the query's number does not split them across doses, otherwise the ranked candidates.
 */
async function byCandidates(
	db: D1Database,
	now: Date,
	query: string,
	resolved: Extract<Resolution, { kind: "candidates" }>,
): Promise<{ data: Data; summary: string }> {
	const shortages = resolved.capped || resolved.splitsDose ? new Map() : await currentShortages(db, resolved.cis);
	const group = resolved.splitsDose
		? undefined
		: aggregationGroup(
				resolved.capped,
				resolved.cis.map((c) => shortages.get(c)?.current.id ?? null),
			);
	if (group === undefined) return candidatesData(db, query, resolved);
	const medicines = (await orderedMedicines(db, resolved.cis.slice(0, LINKED_LIMIT))).map((m) => ({ cis: m.cis, name: m.name }));
	const row = group === null ? null : (resolved.cis.map((c) => shortages.get(c)?.current).find((s) => s?.id === group) ?? null);
	const shortage = row ? toShortageSummary(row, now) : null;
	const related = shortage ? [] : (await possiblyRelated(db, normalize(query))).map((s) => toShortageSummary(s, now));
	let summary: string;
	if (shortage) {
		summary = `All ${resolved.total} medicines matching "${query}" are linked to ANSM entry ${shortage.shortage_id}: ANSM lists ${describeShortage(shortage)}`;
	} else if (related.length > 0) {
		summary = `None of the ${resolved.total} medicines matching "${query}" is linked to a listed ANSM shortage with certainty, but ANSM lists possibly related entries: ${relatedList(related)}. ${NO_GUARANTEE}`;
	} else {
		summary = `None of the ${resolved.total} medicines matching "${query}" is linked to a listed ANSM shortage. ${NO_GUARANTEE}`;
	}
	return { data: { kind: "aggregated", query, total: resolved.total, shortage, medicines, possibly_related_shortages: related }, summary };
}

export const getAvailability: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "get_availability",
	title: "Get availability",
	description: `Current ANSM shortage status of one medicine, given exactly one of: its CIS code, an ANSM shortage id or a name. Returns the status, the expected return in ANSM's wording, the change history and possibly related entries. A name matching several medicines that share the same listed entry (or none) gets one answer for all of them; otherwise ranked candidates with their total, holder, marketing, shortage and MITM status and ATC code; a misspelled name gets a spelling suggestion. ${INFO_ONLY}`,
	inputSchema,
	outputSchema,
	async handler({ db, now }, { cis, shortage_id, name }): Promise<ToolOutcome> {
		const invalid = await exactlyOne(db, { cis, shortage_id, name });
		if (invalid !== null) return invalid;
		const dates = await loadSourceDates(db);
		if (shortage_id !== undefined) return { result: toolResult(await byShortageId(db, now, shortage_id), dates, now) };
		if (cis !== undefined) {
			const medicine = (await getMedicines(db, [cis])).get(cis);
			return { result: toolResult(medicine ? await byCis(db, now, medicine) : notFound(`CIS ${cis}`, []), dates, now), cis };
		}
		const resolved = await resolveName(db, name as string);
		if (resolved.kind === "candidates") return { result: toolResult(await byCandidates(db, now, name as string, resolved), dates, now) };
		if (resolved.kind === "not_found") {
			const related = (await possiblyRelated(db, normalize(name as string))).map((s) => toShortageSummary(s, now));
			return { result: toolResult(notFound(`"${name}"`, related, resolved.did_you_mean), dates, now) };
		}
		return { result: toolResult(await byCis(db, now, resolved.medicine), dates, now), cis: resolved.medicine.cis };
	},
};
