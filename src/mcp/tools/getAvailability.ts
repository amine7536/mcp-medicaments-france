import * as z from "zod";
import { currentShortages, getHistory, getMedicines, getShortage, type HistoryRow, type MedicineRow } from "../../lib/db";
import { normalize } from "../../lib/normalize";
import { envelope, envelopeSchema, errorResult, loadSourceDates, type SourceDates, toolResult, UNKNOWN_DATES } from "../envelope";
import { candidatesSummary, NO_GUARANTEE, notFound, possiblyRelated, relatedList, resolveName } from "../resolve";
import { Candidates, Cis, describeShortage, NotFound, type ShortageRow, ShortageSummary, Status, toShortageSummary } from "../schemas";
import { EXACTLY_ONE, INFO_ONLY, type Tool, type ToolOutcome } from "../tool";

export const NOT_LISTED = `No shortage currently listed by ANSM for this medicine. ${NO_GUARANTEE}`;

const DAY_MS = 86_400_000;

export const inputSchema = z.object({
	cis: Cis.optional().describe("8-digit BDPM medicine code (CIS)."),
	shortage_id: z.string().min(1).max(20).optional().describe("ANSM shortage id, as returned by the other tools."),
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

export const Data = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("availability"),
		medicine: z.object({ cis: Cis, name: z.string(), is_mitm: z.boolean() }).nullable(),
		linked_medicines: z.array(z.object({ cis: Cis, name: z.string(), match_confidence: z.number() })),
		listed: z.boolean(),
		shortage: ShortageSummary.nullable(),
		first_seen_at: z.iso.date().nullable(),
		days_in_current_status: z.int().min(0).nullable(),
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

/** Whole days since the latest status-setting event, else since the situation start, else since first seen. */
export function daysInCurrentStatus(history: HistoryRow[], shortage: ShortageRow, now: Date): number {
	const last = history.findLast((h) => h.change_type === "new" || h.change_type === "status_change" || h.change_type === "relisted");
	const from = last?.detected_at ?? shortage.situation_start ?? shortage.first_seen_at;
	return Math.max(0, Math.floor((now.getTime() - Date.parse(from)) / DAY_MS));
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
				listed: false,
				shortage: null,
				first_seen_at: null,
				days_in_current_status: null,
				history: [],
				other_shortage_ids: [],
				possibly_related_shortages: related,
			},
			summary: `${med ? `${medicineLabel(med)}: ` : ""}${sentence}`,
		};
	}
	const [history, detail] = await Promise.all([getHistory(db, shortage.id), getShortage(db, shortage.id)]);
	const summary = toShortageSummary(shortage, now);
	const days = daysInCurrentStatus(history, shortage, now);
	const listed = shortage.listed === 1;
	const lines = [
		`${med ? medicineLabel(med) : `ANSM entry ${shortage.id}, not linked to a BDPM medicine`}: ANSM lists ${describeShortage(summary)}`,
		`In this status for ${days} day(s).${listed ? "" : " This entry is no longer listed by ANSM."}`,
	];
	if (other_shortage_ids.length > 0) lines.push(`Other listed ANSM entries for this medicine: ${other_shortage_ids.join(", ")}.`);
	return {
		data: {
			kind: "availability",
			medicine: med,
			linked_medicines: (detail?.links ?? []).map(({ cis, name, match_confidence }) => ({ cis, name, match_confidence })),
			listed,
			shortage: summary,
			first_seen_at: shortage.first_seen_at.slice(0, 10),
			days_in_current_status: days,
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
	if (found === null) return { ...notFound(`shortage id "${id}"`, []), cis: null };
	const best = found.links.find((l) => l.is_best === 1) ?? null;
	const medicine = best && ((await getMedicines(db, [best.cis])).get(best.cis) ?? null);
	const others = medicine ? ((await currentShortages(db, [medicine.cis])).get(medicine.cis) ?? null) : null;
	const otherIds = others ? [others.current.id, ...others.other_shortage_ids].filter((x) => x !== id) : [];
	return { ...(await availability(db, now, medicine, found.shortage, otherIds)), cis: medicine?.cis ?? null };
}

const result = (dates: SourceDates, now: Date, out: { data: Data; summary: string }) => toolResult(out.summary, envelope(out.data, dates, now));

export const getAvailability: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "get_availability",
	title: "Get availability",
	description: `Current ANSM shortage status of one medicine, given exactly one of: its CIS code, an ANSM shortage id or a name. Returns the status, the expected return in ANSM's wording, the change history and possibly related unlinked entries. ${INFO_ONLY}`,
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
