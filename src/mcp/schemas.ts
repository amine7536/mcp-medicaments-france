import * as z from "zod";
import { ANSM_ORIGIN } from "../ingest/http";

export const STATUSES = ["rupture", "tension", "arret_commercialisation", "remise_a_disposition", "autre"] as const;
export const SCOPES = ["ville", "hopital", "ville_hopital", "inconnu"] as const;
export const CHANGE_TYPES = ["new", "status_change", "return_date_change", "delisted", "relisted"] as const;

export const Status = z.enum(STATUSES);
export const Scope = z.enum(SCOPES);
export const ChangeType = z.enum(CHANGE_TYPES);
export const Cis = z.string().regex(/^\d{8}$/);

/** Below this match confidence a shortage is reported as a probable match. */
export const PROBABLE_MATCH_BELOW = 0.8;

export const ExpectedReturn = z.object({
	earliest: z.iso.date().nullable(),
	latest: z.iso.date().nullable(),
	precision: z.enum(["day", "month", "quarter", "year"]).nullable(),
	part: z.enum(["debut", "mi", "fin"]).nullable(),
	raw: z.string().nullable(),
	passed: z.boolean(),
});
export type ExpectedReturn = z.infer<typeof ExpectedReturn>;

export const ShortageSummary = z.object({
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

export const Candidates = z.object({ kind: z.literal("candidates"), candidates: z.array(z.object({ cis: Cis, name: z.string() })) });
export const NotFound = z.object({ kind: z.literal("not_found"), possibly_related_shortages: z.array(ShortageSummary) });

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

/** The UTC calendar date of `now`, `YYYY-MM-DD`. */
export const utcDate = (now: Date): string => now.toISOString().slice(0, 10);

export function toShortageSummary(row: ShortageRow, now: Date): ShortageSummary {
	const latest = row.expected_return_latest;
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
			passed: latest !== null && latest < utcDate(now),
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
	return `${line}.`;
}
