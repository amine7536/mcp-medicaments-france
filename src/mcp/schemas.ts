import * as z from "zod";
import { SCOPES, STATUSES } from "../ingest/ansm";
import { ANSM_ORIGIN } from "../ingest/http";
import { RETURN_PARTS, RETURN_PRECISIONS } from "../lib/dates";

export const CHANGE_TYPES = ["new", "status_change", "return_date_change", "delisted", "relisted"] as const;

export const Status = z.enum(STATUSES);
export const Scope = z.enum(SCOPES);
export const ChangeType = z.enum(CHANGE_TYPES);
export const Cis = z.string().regex(/^\d{8}$/);
export const Cip13 = z.string().regex(/^\d{13}$/);

/** An output object: served without forbidding extra properties, because clients validate results against the schema they cached. */
export function outputObject<T extends z.core.$ZodLooseShape>(shape: T) {
	return z.object(shape).meta({ additionalProperties: {} });
}

/** EAN-13 check digit of the first 12 digits of a code: weights 1 and 3 alternating from the left. */
export function ean13CheckDigit(first12: string): number {
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
	return (10 - (sum % 10)) % 10;
}

/** Whether `code` is 13 digits whose last digit is the EAN-13 check digit of the first 12. */
export const isValidEan13 = (code: string): boolean => /^\d{13}$/.test(code) && ean13CheckDigit(code) === Number(code[12]);

/** Below this match confidence a shortage is reported as a probable match. */
export const PROBABLE_MATCH_BELOW = 0.8;

export const ExpectedReturn = outputObject({
	earliest: z.iso.date().nullable(),
	latest: z.iso.date().nullable(),
	precision: z.enum(RETURN_PRECISIONS).nullable(),
	part: z.enum(RETURN_PARTS).nullable(),
	raw: z.string().nullable(),
	passed: z.boolean(),
	/** A "début" or "mi" month return past this service's cutoff (the 10th, or the 20th) while `passed` is false; absent otherwise. */
	likely_overdue: z.literal(true).optional(),
});
export type ExpectedReturn = z.infer<typeof ExpectedReturn>;

export const ShortageSummary = outputObject({
	shortage_id: z.string(),
	name: z.string(),
	dci: z.string().nullable(),
	status: Status,
	status_label_fr: z.string(),
	scope: Scope,
	scope_raw: z.string().nullable(),
	expected_return: ExpectedReturn,
	returned_at: z.iso.date().nullable(),
	ansm_updated_at: z.iso.date().nullable(),
	ansm_url: z.url(),
	match_confidence: z.number().nullable(),
	match_note: z.literal("probable match").optional(),
});
export type ShortageSummary = z.infer<typeof ShortageSummary>;

/** A medicine matching a name, with what tells homonyms apart. */
export const Candidate = outputObject({
	cis: Cis,
	name: z.string(),
	holder: z.string().nullable(),
	marketing_status: z.string().nullable(),
	shortage_status: Status.nullable(),
	is_mitm: z.boolean(),
	atc_code: z.string().nullable(),
	/** Its name matches the brand and dose of the query; absent otherwise. */
	best_match: z.literal(true).optional(),
});
export const Candidates = outputObject({
	kind: z.literal("candidates"),
	total: z.int().min(0),
	capped: z.boolean(),
	candidates: z.array(Candidate),
	/** How many matches carry `best_match`, shown or not; absent when none does. */
	best_match_total: z.int().min(1).optional(),
	/** How many matches, shown or not, are in rupture or tension (listed first); absent when none is. */
	in_shortage_total: z.int().min(1).optional(),
});
export const NotFound = outputObject({
	kind: z.literal("not_found"),
	possibly_related_shortages: z.array(ShortageSummary),
	did_you_mean: z.string().nullable(),
});

/** A therapeutic fraction (BDPM FT row) of a substance: the dosage of its active part, for example the base of a salt. */
export const TherapeuticFraction = outputObject({
	name: z.string(),
	dosage: z.string().nullable(),
	reference: z.string().optional(),
});

/** An active substance (BDPM SA row) of a medicine; `reference` and `therapeutic_fractions` are absent when the BDPM has none. */
export const Substance = outputObject({
	name: z.string(),
	dosage: z.string().nullable(),
	reference: z.string().optional(),
	therapeutic_fractions: z.array(TherapeuticFraction).optional(),
});
export type Substance = z.infer<typeof Substance>;

export const Medicine = outputObject({
	cis: Cis,
	name: z.string(),
	form: z.string().nullable(),
	routes: z.string().nullable(),
	holder: z.string().nullable(),
	marketing_status: z.string().nullable(),
	is_mitm: z.boolean(),
	/** BDPM authorisation (AMM) status; absent when unknown. */
	amm_status: z.string().optional(),
	/** Absent when the BDPM lists no substance. */
	substances: z.array(Substance).optional(),
});
export type Medicine = z.infer<typeof Medicine>;

/** A BDPM presentation (box) of a medicine. */
export const Presentation = outputObject({
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
export type Presentation = z.infer<typeof Presentation>;

/** An ANSM safety information item of a medicine, as listed in the BDPM: the ANSM page title and link, and its validity window. */
export const SafetyInformation = outputObject({
	title: z.string(),
	url: z.url(),
	starts_on: z.iso.date(),
	ends_on: z.iso.date(),
});
export type SafetyInformation = z.infer<typeof SafetyInformation>;

/** A `shortages` row with the match confidence of its context (null when unmatched). */
export interface ShortageRow {
	id: string;
	ansm_path: string;
	raw_name: string;
	dci_raw: string | null;
	status: z.infer<typeof Status>;
	status_raw: string;
	scope: z.infer<typeof Scope>;
	scope_raw: string | null;
	expected_return_earliest: string | null;
	expected_return_latest: string | null;
	expected_return_precision: ExpectedReturn["precision"];
	expected_return_part: ExpectedReturn["part"];
	expected_return_raw: string | null;
	returned_at: string | null;
	situation_start: string | null;
	ansm_updated_at: string | null;
	first_seen_at: string;
	listed: number;
	match_confidence: number | null;
}

export const utcDate = (now: Date): string => now.toISOString().slice(0, 10);

/** Day of the month after which a "début" or "mi" month return is read as likely overdue. Not an ANSM date. */
const LIKELY_OVERDUE_AFTER_DAY = { debut: 10, mi: 20 } as const;

/** Whether a "début" or "mi" month return is past its cutoff while its window has not ended. */
function likelyOverdue(row: ShortageRow, today: string, passed: boolean): boolean {
	const part = row.expected_return_part;
	const earliest = row.expected_return_earliest;
	if (passed || row.expected_return_precision !== "month" || earliest === null || (part !== "debut" && part !== "mi")) return false;
	return today > `${earliest.slice(0, 8)}${String(LIKELY_OVERDUE_AFTER_DAY[part]).padStart(2, "0")}`;
}

/** Summary sentence of a likely overdue "début" or "mi" return. */
export function likelyOverdueNote(part: "debut" | "mi"): string {
	const period = part === "debut" ? "début" : "mi";
	return `The announced "${period}" period has likely passed (read by this service as after the ${LIKELY_OVERDUE_AFTER_DAY[part]}th of the month; not an ANSM date)`;
}

export function toShortageSummary(row: ShortageRow, now: Date): ShortageSummary {
	const latest = row.expected_return_latest;
	const today = utcDate(now);
	const passed = latest !== null && latest < today;
	return {
		shortage_id: row.id,
		name: row.raw_name,
		dci: row.dci_raw,
		status: row.status,
		status_label_fr: row.status_raw,
		scope: row.scope,
		scope_raw: row.scope_raw,
		expected_return: {
			earliest: row.expected_return_earliest,
			latest,
			precision: row.expected_return_precision,
			part: row.expected_return_part,
			raw: row.expected_return_raw,
			passed,
			...(likelyOverdue(row, today, passed) ? { likely_overdue: true as const } : {}),
		},
		returned_at: row.returned_at,
		ansm_updated_at: row.ansm_updated_at,
		ansm_url: ANSM_ORIGIN + row.ansm_path,
		match_confidence: row.match_confidence,
		...(row.match_confidence !== null && row.match_confidence < PROBABLE_MATCH_BELOW ? { match_note: "probable match" as const } : {}),
	};
}

/** Summary line of a shortage: ANSM label, scope, expected return in ANSM's own wording. */
export function describeShortage(s: ShortageSummary): string {
	const parts = [`${s.name}: "${s.status_label_fr}" (${s.status})`];
	if (s.scope_raw !== null) parts.push(`scope: ${s.scope_raw}`);
	if (s.match_note !== undefined) parts.push(`${s.match_note}, confidence ${s.match_confidence}`);
	let line = parts.join(", ");
	if (s.expected_return.raw !== null) line += `. Expected return (ANSM wording): "${s.expected_return.raw}"`;
	if (s.expected_return.passed) line += ". The announced return date has passed";
	if (s.expected_return.likely_overdue && (s.expected_return.part === "debut" || s.expected_return.part === "mi")) line += `. ${likelyOverdueNote(s.expected_return.part)}`;
	return `${line}.`;
}
