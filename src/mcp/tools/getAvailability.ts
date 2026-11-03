import * as z from "zod";
import { currentShortages, getHistory, getMedicines, getShortage, type HistoryRow, type MedicineRow } from "../../lib/db";
import { normalize } from "../../lib/normalize";
import { envelope, envelopeSchema, errorResult, loadSourceDates, type SourceDates, toolResult, UNKNOWN_DATES } from "../envelope";
import { candidatesSummary, NO_GUARANTEE, notFound, possiblyRelated, relatedList, resolveName } from "../resolve";
import { Candidates, Cis, describeShortage, NotFound, type ShortageRow, ShortageSummary, Status, toShortageSummary } from "../schemas";
import { EXACTLY_ONE, INFO_ONLY, type Tool, type ToolOutcome } from "../tool";

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
	z.object({ date: z.iso.date(), change: z.literal("new"), status: Status.nullable() }),
	z.object({ date: z.iso.date(), change: z.literal("status_change"), from: Status.nullable(), to: Status.nullable() }),
	z.object({ date: z.iso.date(), change: z.literal("return_date_change"), from_raw: z.string().nullable(), to_raw: z.string().nullable() }),
	z.object({ date: z.iso.date(), change: z.literal("delisted") }),
	z.object({ date: z.iso.date(), change: z.literal("relisted") }),
]);
type HistoryItem = z.infer<typeof HistoryItem>;

const StatusSinceSource = z.enum(["ansm", "service"]);

export const Data = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("availability"),
		medicine: z.object({ cis: Cis, name: z.string(), is_mitm: z.boolean() }).nullable(),
		linked_medicines: z.array(z.object({ cis: Cis, name: z.string(), match_confidence: z.number() })),
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

async function byShortageId(db: D1Database, now: Date, id: string): Promise<{ data: Data; summary: string; cis: string | null }> {
	const found = await getShortage(db, id);
	if (found === null) {
		return {
			data: { kind: "not_found", possibly_related_shortages: [] },
			summary: `No ANSM shortage entry with id "${id}". Use search_medicine or list_current_shortages to find an entry.`,
			cis: null,
		};
	}
	return { ...(await availability(db, now, null, found.shortage, [])), cis: null };
}

const result = (dates: SourceDates, now: Date, out: { data: Data; summary: string }) => toolResult(out.summary, envelope(out.data, dates, now));

export const getAvailability: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "get_availability",
	title: "Get availability",
	description: `Current ANSM shortage status of one medicine, given exactly one of: its CIS code, an ANSM shortage id or a name. Returns the status, the expected return in ANSM's wording, the change history and possibly related entries. ${INFO_ONLY}`,
	inputSchema,
	outputSchema,
	async handler({ db, now }, { cis, shortage_id, name }): Promise<ToolOutcome> {
		if ([cis, shortage_id, name].filter((a) => a !== undefined).length !== 1) {
			return { result: errorResult(EXACTLY_ONE("cis, shortage_id or name"), await loadSourceDates(db).catch(() => UNKNOWN_DATES)) };
		}
		const dates = await loadSourceDates(db);
		if (shortage_id !== undefined) {
			const out = await byShortageId(db, now, shortage_id);
			return { result: result(dates, now, out), cis: out.cis };
		}
		if (cis !== undefined) {
			const medicine = (await getMedicines(db, [cis])).get(cis);
			return { result: result(dates, now, medicine ? await byCis(db, now, medicine) : notFound(`CIS ${cis}`, [])), cis };
		}
		const resolved = await resolveName(db, name as string);
		if (resolved.kind === "candidates") {
			return { result: result(dates, now, { data: resolved, summary: candidatesSummary(name as string) }) };
		}
		if (resolved.kind === "not_found") {
			const related = (await possiblyRelated(db, normalize(name as string))).map((s) => toShortageSummary(s, now));
			return { result: result(dates, now, notFound(`"${name}"`, related)) };
		}
		return { result: result(dates, now, await byCis(db, now, resolved.medicine)), cis: resolved.medicine.cis };
	},
};
