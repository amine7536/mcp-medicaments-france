import * as z from "zod";
import { ANSM_ORIGIN } from "../../ingest/http";
import { recentChanges as loadChanges } from "../../lib/db";
import { envelope, envelopeSchema, loadSourceDates, toolResult } from "../envelope";
import { CHANGE_TYPES, ChangeType, Status } from "../schemas";
import { INFO_ONLY, type Tool } from "../tool";

export const CHANGES_NOTE = "Dates are detection dates by this service (daily cadence), not official ANSM decision dates.";

const DAY_MS = 86_400_000;

export const inputSchema = z.object({
	days: z.int().min(1).max(90).default(7),
	change_types: z.array(ChangeType).default([...CHANGE_TYPES]),
	limit: z.int().min(1).max(50).default(50),
});

export const Data = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("changes"),
		since: z.iso.datetime(),
		counts: z.record(ChangeType, z.int().min(0)),
		items: z.array(
			z.object({
				date: z.iso.datetime(),
				change: ChangeType,
				shortage_id: z.string(),
				name: z.string(),
				ansm_url: z.url(),
				old_status: Status.nullable(),
				new_status: Status.nullable(),
				old_expected_return: z.string().nullable(),
				new_expected_return: z.string().nullable(),
			}),
		),
		note: z.literal(CHANGES_NOTE),
	}),
]);

export const outputSchema = envelopeSchema(Data);

export const recentChanges: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "recent_changes",
	title: "Recent changes",
	description: `Shortage changes detected in the last days (new entries, status changes, expected-return changes, delisted and relisted entries), latest first, with counts per change type. ${INFO_ONLY}`,
	inputSchema,
	outputSchema,
	async handler({ db, now }, { days, change_types, limit }) {
		const dates = await loadSourceDates(db);
		const since = new Date(now.getTime() - days * DAY_MS).toISOString();
		const { counts: byType, items: rows } = await loadChanges(db, since, change_types, limit);
		const counts = Object.fromEntries(CHANGE_TYPES.map((t) => [t, byType.get(t) ?? 0])) as Record<(typeof CHANGE_TYPES)[number], number>;
		const items = rows.map((r) => ({
			date: r.detected_at,
			change: r.change_type,
			shortage_id: r.shortage_id,
			name: r.name,
			ansm_url: ANSM_ORIGIN + r.ansm_path,
			old_status: r.old_status as z.infer<typeof Status> | null,
			new_status: r.new_status as z.infer<typeof Status> | null,
			old_expected_return: r.old_expected_return,
			new_expected_return: r.new_expected_return,
		}));
		const lines = [
			`Changes detected in the last ${days} day(s): ${CHANGE_TYPES.map((t) => `${counts[t]} ${t}`).join(", ")}. ${CHANGES_NOTE}`,
			...items.map((i) => {
				const detail =
					i.change === "status_change"
						? ` (${i.old_status} -> ${i.new_status})`
						: i.change === "return_date_change"
							? ` (ANSM wording: "${i.old_expected_return ?? ""}" -> "${i.new_expected_return ?? ""}")`
							: "";
				return `- ${i.date.slice(0, 10)} ${i.change}: ${i.name}${detail}`;
			}),
		];
		return { result: toolResult(lines.join("\n"), envelope({ kind: "changes" as const, since, counts, items, note: CHANGES_NOTE }, dates, now)) };
	},
};
