import * as z from "zod";
import { listShortages } from "../../lib/db";
import { normalize } from "../../lib/normalize";
import { envelope, envelopeSchema, loadSourceDates, toolResult } from "../envelope";
import { Cis, describeShortage, Scope, ShortageSummary, Status, toShortageSummary } from "../schemas";
import { INFO_ONLY, type Tool } from "../tool";

/** `scope` filter value → accepted `shortages.scope` values: a city or hospital filter includes city-and-hospital entries. */
export const SCOPE_MATCHES: Record<z.infer<typeof Scope>, string[]> = {
	ville: ["ville", "ville_hopital"],
	hopital: ["hopital", "ville_hopital"],
	ville_hopital: ["ville_hopital"],
	inconnu: ["inconnu"],
};

export const inputSchema = z.object({
	status: z.array(Status).default(["rupture", "tension"]),
	scope: Scope.optional().describe("ville (city pharmacies), hopital (hospitals), ville_hopital or inconnu."),
	therapeutic_area: z.string().min(2).max(60).optional().describe("Therapeutic area as written by ANSM, e.g. \"cardiologie\"."),
	updated_since: z.iso.date().optional().describe("Only entries updated by ANSM on or after this date (YYYY-MM-DD)."),
	limit: z.int().min(1).max(50).default(25),
	offset: z.int().min(0).max(10000).default(0),
});

export const Data = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("list"),
		total: z.int().min(0),
		items: z.array(ShortageSummary.extend({ cis: z.array(Cis) })),
		next_offset: z.int().min(0).nullable(),
	}),
]);

export const outputSchema = envelopeSchema(Data);

export const listCurrentShortages: Tool<typeof inputSchema, typeof outputSchema> = {
	name: "list_current_shortages",
	title: "List current shortages",
	description: `List medicine shortages currently published by ANSM, latest update first, filtered by status, scope, therapeutic area and update date, with the CIS codes of the matched medicines. ${INFO_ONLY}`,
	inputSchema,
	outputSchema,
	async handler({ db, now }, { status, scope, therapeutic_area, updated_since, limit, offset }) {
		const dates = await loadSourceDates(db);
		const area = therapeutic_area === undefined ? null : normalize(therapeutic_area);
		// An area that normalizes to nothing matches no entry (instr with '' would match every row).
		const { total, items: rows } =
			area === ""
				? { total: 0, items: [] }
				: await listShortages(db, {
						statuses: status,
						scopes: scope === undefined ? null : SCOPE_MATCHES[scope],
						area,
						updatedSince: updated_since ?? null,
						limit,
						offset,
					});
		const items = rows.map((r) => ({ ...toShortageSummary(r, now), cis: r.cis }));
		const next_offset = offset + items.length < total ? offset + items.length : null;
		const lines = [`${total} listed ANSM entr${total === 1 ? "y" : "ies"} match; showing ${items.length} from offset ${offset}.`];
		for (const s of items) lines.push(`- ${describeShortage(s)}`);
		if (next_offset !== null) lines.push(`More results: call again with offset ${next_offset}.`);
		return { result: toolResult(lines.join("\n"), envelope({ kind: "list" as const, total, items, next_offset }, dates, now)) };
	},
};
