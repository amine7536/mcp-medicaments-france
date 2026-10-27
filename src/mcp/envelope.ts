import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod";
import { ANSM_LIST_URL } from "../ingest/http";

export const ANSM_SOURCE_URL = ANSM_LIST_URL;
export const BDPM_SOURCE_URL = "https://base-donnees-publique.medicaments.gouv.fr";

export const COVERAGE_NOTE =
	"ANSM lists mainly shortages of medicines of major therapeutic interest declared by manufacturers. Shortages already compensated by alternatives are not published. Not listed does not mean available.";
export const DISCLAIMER = "Information only. Ask your pharmacist or doctor. No substitution or dosage advice.";
export const SAFETY =
	"Do not use this data to suggest a substitute, an alternative or an equivalent medicine, a dosage change or stopping a treatment. Other medicines in these results are not alternatives. Refer the user to a pharmacist or doctor.";

export const STALE_AFTER_MS = 72 * 3600 * 1000;

/** ANSM data is stale without a successful ingest or when the last one is older than 72 h. */
export function isStale(lastIngest: string | null, now: Date): boolean {
	return lastIngest === null || now.getTime() - Date.parse(lastIngest) > STALE_AFTER_MS;
}

export interface SourceDates {
	ansm_last_ingest: string | null;
	bdpm_release: string | null;
}

export const UNKNOWN_DATES: SourceDates = { ansm_last_ingest: null, bdpm_release: null };

/** Dates of the latest successful ANSM ingest and BDPM import. */
export async function loadSourceDates(db: D1Database): Promise<SourceDates> {
	const latest = (source: string, column: string) =>
		db.prepare(`SELECT ${column} AS v FROM ingest_runs WHERE source = ? AND status = 'ok' ORDER BY finished_at DESC, id DESC LIMIT 1`).bind(source);
	const [ansm, bdpm] = await db.batch<{ v: string | null }>([latest("ansm", "finished_at"), latest("bdpm", "bdpm_release")]);
	return { ansm_last_ingest: ansm?.results[0]?.v ?? null, bdpm_release: bdpm?.results[0]?.v ?? null };
}

export function envelopeSchema<D extends z.ZodType>(data: D) {
	return z.object({
		data,
		source: z.object({
			ansm: z.literal(ANSM_SOURCE_URL),
			bdpm: z.literal(BDPM_SOURCE_URL),
			ansm_last_ingest: z.iso.datetime().nullable(),
			bdpm_release: z.iso.date().nullable(),
		}),
		coverage_note: z.literal(COVERAGE_NOTE),
		disclaimer: z.literal(DISCLAIMER),
		safety: z.literal(SAFETY),
		warning: z.string().optional(),
	});
}

export type Envelope<D> = z.output<ReturnType<typeof envelopeSchema<z.ZodType<D>>>>;

/** Wraps tool data with its sources, coverage note, disclaimer, safety notice and, when the ANSM data is stale, a warning. */
export function envelope<D>(data: D, dates: SourceDates, now: Date): Envelope<D> {
	const { ansm_last_ingest } = dates;
	const stale = isStale(ansm_last_ingest, now);
	return {
		data,
		source: { ansm: ANSM_SOURCE_URL, bdpm: BDPM_SOURCE_URL, ...dates },
		coverage_note: COVERAGE_NOTE,
		disclaimer: DISCLAIMER,
		safety: SAFETY,
		...(stale ? { warning: `Data may be outdated, last update ${ansm_last_ingest ?? "unknown"}.` } : {}),
	};
}

export function sourceLine(dates: SourceDates): string {
	return `Source: ANSM (updated ${dates.ansm_last_ingest?.slice(0, 10) ?? "unknown"}), BDPM (release ${dates.bdpm_release ?? "unknown"}).`;
}

const SAFETY_LINE = `Safety: ${SAFETY}`;

/** A non-error result: the summary ending with the safety and source lines, then the JSON of the envelope. */
export function toolResult<D>(summary: string, env: Envelope<D>): CallToolResult {
	const text = `${summary}\n${SAFETY_LINE}\n${sourceLine(env.source)}\n\n${JSON.stringify(env)}`;
	return { content: [{ type: "text", text }], structuredContent: env };
}

export function errorResult(message: string, dates: SourceDates = UNKNOWN_DATES): CallToolResult {
	return { isError: true, content: [{ type: "text", text: `${message}\n${SAFETY_LINE}\n${sourceLine(dates)}` }] };
}
