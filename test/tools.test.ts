import { env } from "cloudflare:workers";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as z from "zod";
import { log } from "../src/ingest/http";
import { getMedicineInfo as loadInfo } from "../src/lib/db";
import { normalize } from "../src/lib/normalize";
import { ANSM_SOURCE_URL, BDPM_SOURCE_URL, COVERAGE_NOTE, DISCLAIMER, isStale, SAFETY, sourceLine } from "../src/mcp/envelope";
import { Medicine, Presentation, SafetyInformation } from "../src/mcp/schemas";
import { runTool, type Tool, type ToolContext, UNAVAILABLE } from "../src/mcp/tool";
import { getAvailability, NOT_LISTED } from "../src/mcp/tools/getAvailability";
import { Data, getMedicineInfo, NO_SAFETY_INFORMATION, SAFETY_ADVICE, SUMMARY_LIMIT } from "../src/mcp/tools/getMedicineInfo";
import { isMajorTherapeuticInterest, MITM_DEFINITION } from "../src/mcp/tools/isMajorTherapeuticInterest";
import { listCurrentShortages } from "../src/mcp/tools/listCurrentShortages";
import { CHANGES_NOTE, recentChanges } from "../src/mcp/tools/recentChanges";
import { SHORTAGE_NOTE, searchMedicine } from "../src/mcp/tools/searchMedicine";
import { ANSM_LAST_INGEST, BDPM_IMPORTED_AT, BDPM_RELEASE, MEDICINES, MONTH_RAW, NOW, PASSED_RAW, PRESCRIPTION_CONDITIONS, PRESENTATIONS, SAFETY_INFORMATION, SHORTAGES, seed } from "./seed";

const SOURCE_LINE = `Source: ANSM (updated 2026-10-27), BDPM (release ${BDPM_RELEASE}, imported 2026-10-05).`;
const UNKNOWN_SOURCE_LINE = "Source: ANSM (updated unknown), BDPM (release unknown, imported unknown).";
const SAFETY_LINE = `Safety: ${SAFETY}`;

const ctx: ToolContext = { db: env.DB, now: NOW };

const text = (r: CallToolResult): string => (r.content[0] as { text: string }).text;
/** The summary part of a result's text (before the JSON). */
const summary = (r: CallToolResult): string => text(r).split("\n\n")[0] as string;

/** A D1 binding whose every query throws. */
const brokenDb = (): D1Database =>
	new Proxy(env.DB, {
		get(target, prop) {
			if (prop === "prepare" || prop === "batch") return () => { throw new Error("D1_ERROR: database unavailable"); };
			return Reflect.get(target, prop);
		},
	});

/**
 * Calls a handler with arguments parsed by its input schema; every non-error result is checked against
 * the tool's output schema and the envelope fields, and its data returned.
 */
async function call<I extends z.ZodObject, O extends z.ZodType>(tool: Tool<I, O>, args: z.input<I>, at: Date = NOW) {
	const { result } = await tool.handler({ ...ctx, now: at }, tool.inputSchema.parse(args));
	if (result.isError) return { result, data: undefined as never, sc: undefined as never };
	const parsed = tool.outputSchema.safeParse(result.structuredContent);
	expect(parsed.error).toBeUndefined();
	const sc = result.structuredContent as {
		data: Record<string, unknown> & { kind: string };
		source: Record<string, unknown>;
		coverage_note: string;
		disclaimer: string;
		safety: string;
		warning?: string;
	};
	expect(sc.source).toMatchObject({ ansm: ANSM_SOURCE_URL, bdpm: BDPM_SOURCE_URL });
	expect(sc.coverage_note).toBe(COVERAGE_NOTE);
	expect(sc.disclaimer).toBe(DISCLAIMER);
	const { ansm_last_ingest, bdpm_release, bdpm_imported_at } = sc.source as {
		ansm_last_ingest: string | null;
		bdpm_release: string | null;
		bdpm_imported_at: string | null;
	};
	expect(sc.safety).toBe(SAFETY);
	expect(summary(result).endsWith(`\n${SAFETY_LINE}\nSource: ANSM (updated ${ansm_last_ingest?.slice(0, 10) ?? "unknown"}), BDPM (release ${bdpm_release ?? "unknown"}, imported ${bdpm_imported_at?.slice(0, 10) ?? "unknown"}).`)).toBe(true);
	expect(text(result)).toBe(`${summary(result)}\n\n${JSON.stringify(sc)}`);
	return { result, data: sc.data as any, sc };
}

// Seeding and many D1 round-trips run slower on CI runners.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

beforeAll(async () => {
	await seed();
});

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("envelope", () => {
	it("carries the fixed safety notice", () => {
		expect(SAFETY).toBe(
			"Do not name or suggest any substitute, alternative or equivalent medicine, whether from these results or from your own knowledge, and do not suggest a dosage change or stopping a treatment. Other medicines in these results are not alternatives. Refer the user to a pharmacist or doctor.",
		);
	});

	it("isStale: null or older than 72 h", () => {
		const at = Date.parse(ANSM_LAST_INGEST);
		expect(isStale(null, NOW)).toBe(true);
		expect(isStale(ANSM_LAST_INGEST, new Date(at + 72 * 3600_000))).toBe(false);
		expect(isStale(ANSM_LAST_INGEST, new Date(at + 72 * 3600_000 + 1))).toBe(true);
	});

	it("carries the source dates and no warning when fresh", async () => {
		const { sc } = await call(searchMedicine, { query: "kardegic" });
		expect(sc.source).toEqual({
			ansm: ANSM_SOURCE_URL,
			bdpm: BDPM_SOURCE_URL,
			ansm_last_ingest: ANSM_LAST_INGEST,
			bdpm_release: BDPM_RELEASE,
			bdpm_imported_at: BDPM_IMPORTED_AT,
		});
		expect(sc.warning).toBeUndefined();
	});

	it("sourceLine: prints the BDPM release and import dates", () => {
		expect(sourceLine({ ansm_last_ingest: ANSM_LAST_INGEST, bdpm_release: "2026-09-29", bdpm_imported_at: "2026-11-02T04:00:00.000Z" })).toBe(
			"Source: ANSM (updated 2026-10-27), BDPM (release 2026-09-29, imported 2026-11-02).",
		);
	});

	it("reads unknown BDPM dates when no BDPM import succeeded", async () => {
		await env.DB.prepare("UPDATE ingest_runs SET status = 'error' WHERE source = 'bdpm'").run();
		try {
			const { sc } = await call(getMedicineInfo, { cis: MEDICINES.dolipraneTablet.cis });
			expect(sc.source.bdpm_release).toBeNull();
			expect(sc.source.bdpm_imported_at).toBeNull();
		} finally {
			await env.DB.prepare("UPDATE ingest_runs SET status = 'ok' WHERE source = 'bdpm'").run();
		}
	});

	it("warns when the last ANSM ingest is older than 72 h", async () => {
		const { sc } = await call(searchMedicine, { query: "kardegic" }, new Date("2026-10-30T06:00:00.000Z"));
		expect(sc.warning).toBe(`Data may be outdated, last update ${ANSM_LAST_INGEST}.`);
		const { sc: fresh } = await call(searchMedicine, { query: "kardegic" }, new Date("2026-10-30T05:00:00.000Z"));
		expect(fresh.warning).toBeUndefined();
	});

	it("warns with an unknown date when no ANSM ingest succeeded", async () => {
		await env.DB.prepare("UPDATE ingest_runs SET status = 'error' WHERE source = 'ansm'").run();
		try {
			const { sc, result } = await call(searchMedicine, { query: "kardegic" });
			expect(sc.source.ansm_last_ingest).toBeNull();
			expect(sc.warning).toBe("Data may be outdated, last update unknown.");
			expect(summary(result)).toContain(`Source: ANSM (updated unknown), BDPM (release ${BDPM_RELEASE}, imported 2026-10-05).`);
		} finally {
			await env.DB.prepare("UPDATE ingest_runs SET status = 'ok' WHERE source = 'ansm'").run();
		}
	});
});

describe("search_medicine", () => {
	it("applies the defaults and bounds of its input", () => {
		expect(searchMedicine.inputSchema.parse({ query: "ab" })).toEqual({ query: "ab", only_in_shortage: false, limit: 10 });
		expect(searchMedicine.inputSchema.safeParse({ query: "a" }).success).toBe(false);
		expect(searchMedicine.inputSchema.safeParse({ query: "x".repeat(101) }).success).toBe(false);
		expect(searchMedicine.inputSchema.safeParse({ query: "ab", limit: 26 }).success).toBe(false);
		expect(searchMedicine.inputSchema.safeParse({ query: "ab", limit: 0 }).success).toBe(false);
	});

	it("ranks shortages first, adds shortage_note and unmatched shortages", async () => {
		const { data, result } = await call(searchMedicine, { query: "doliprane" });
		expect(data.kind).toBe("results");
		expect(data.results.map((r: { cis: string }) => r.cis)).toEqual([MEDICINES.dolipraneTablet.cis, MEDICINES.dolipraneCapsule.cis]);
		const [tablet, capsule] = data.results;
		expect(tablet).toMatchObject({
			name: MEDICINES.dolipraneTablet.name,
			form: "comprimé",
			substances: [{ name: "PARACÉTAMOL", dosage: "1000 mg" }],
			is_mitm: true,
			shortage: { shortage_id: SHORTAGES.dolipraneRupture.id, status: "rupture", status_label_fr: "Rupture de stock", match_confidence: 1 },
		});
		expect(tablet.shortage_note).toBeUndefined();
		expect(tablet.shortage.match_note).toBeUndefined();
		expect(tablet.shortage.ansm_url).toBe(`https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/entry-${SHORTAGES.dolipraneRupture.id}`);
		expect(capsule).toMatchObject({ is_mitm: false, shortage: null, shortage_note: SHORTAGE_NOTE });
		expect(data.unmatched_shortages.map((s: { shortage_id: string }) => s.shortage_id)).toEqual([SHORTAGES.dolipraneUnmatched.id]);
		expect(data.unmatched_shortages[0].match_confidence).toBeNull();
		expect(summary(result)).toContain(SHORTAGES.dolipraneUnmatched.name);
	});

	it("only_in_shortage keeps rupture and tension results; limit truncates", async () => {
		const only = await call(searchMedicine, { query: "doliprane", only_in_shortage: true });
		expect(only.data.results.map((r: { cis: string }) => r.cis)).toEqual([MEDICINES.dolipraneTablet.cis]);
		const one = await call(searchMedicine, { query: "doliprane", limit: 1 });
		expect(one.data.results).toHaveLength(1);
		const zymad = await call(searchMedicine, { query: "zymad", only_in_shortage: true });
		expect(zymad.data.results).toEqual([]);
	});

	it("finds by active substance and by prefix", async () => {
		const { data } = await call(searchMedicine, { query: "paracétamol" });
		expect(data.results).toHaveLength(2);
		const prefix = await call(searchMedicine, { query: "amoxi" });
		expect(prefix.data.results[0]).toMatchObject({ cis: MEDICINES.amoxicilline.cis, shortage: { match_note: "probable match", match_confidence: 0.6 } });
	});

	it("suggests spelling or substance when nothing matches, and FTS syntax is inert", async () => {
		const { data, result } = await call(searchMedicine, { query: "zzzunknown" });
		expect(data.results).toEqual([]);
		expect(summary(result)).toContain("Check the spelling or search by active substance");
		const syntax = await call(searchMedicine, { query: '"* OR NEAR(' });
		expect(syntax.data.results).toEqual([]);
	});

	it("resolves a 13-digit query as a CIP13", async () => {
		const { data } = await call(searchMedicine, { query: ` ${PRESENTATIONS.dolipraneBoxOf100.cip13} ` });
		expect(data.results.map((r: { cis: string }) => r.cis)).toEqual([MEDICINES.dolipraneTablet.cis]);
		const unknown = await call(searchMedicine, { query: "3400999999999" });
		expect(unknown.data.results).toEqual([]);
	});

	it("quotes the ANSM wording of a month-precision return, never a bare ISO date", async () => {
		const { result } = await call(searchMedicine, { query: "doliprane 1000" });
		const s = summary(result);
		expect(s).toContain(`Expected return (ANSM wording): "${MONTH_RAW}"`);
		expect(s).not.toMatch(/2026-11-01|2026-11-30/);
	});
});

describe("get_availability", () => {
	it("requires exactly one argument, with the source line", async () => {
		for (const args of [{}, { cis: MEDICINES.kardegic.cis, name: "kardegic" }, { cis: MEDICINES.kardegic.cis, shortage_id: "1001", name: "x".repeat(3) }]) {
			const { result } = await call(getAvailability, args);
			expect(result.isError).toBe(true);
			expect(text(result)).toBe(`Provide exactly one of cis, shortage_id or name.\n${SAFETY_LINE}\n${SOURCE_LINE}`);
		}
	});

	it("returns the argument error with unknown dates when the source dates fail to load", async () => {
		const { result } = await getAvailability.handler({ db: brokenDb(), now: NOW }, getAvailability.inputSchema.parse({}));
		expect(result).toEqual({ isError: true, content: [{ type: "text", text: `Provide exactly one of cis, shortage_id or name.\n${SAFETY_LINE}\n${UNKNOWN_SOURCE_LINE}` }] });
	});

	it("validates its input", () => {
		expect(getAvailability.inputSchema.safeParse({ cis: "1234567" }).success).toBe(false);
		expect(getAvailability.inputSchema.safeParse({ shortage_id: "" }).success).toBe(false);
		expect(getAvailability.inputSchema.safeParse({ shortage_id: "x".repeat(21) }).success).toBe(false);
		expect(getAvailability.inputSchema.safeParse({ name: "a" }).success).toBe(false);
	});

	it("availability by CIS: current shortage, history, days, other ids, linked medicines", async () => {
		const { data, result } = await call(getAvailability, { cis: MEDICINES.dolipraneTablet.cis });
		expect(data).toMatchObject({
			kind: "availability",
			medicine: { cis: MEDICINES.dolipraneTablet.cis, name: MEDICINES.dolipraneTablet.name, is_mitm: true },
			linked_medicines: [{ cis: MEDICINES.dolipraneTablet.cis, name: MEDICINES.dolipraneTablet.name, match_confidence: 1 }],
			listed: true,
			shortage: { shortage_id: SHORTAGES.dolipraneRupture.id, status: "rupture", expected_return: { precision: "month", raw: MONTH_RAW, passed: false } },
			first_seen_at: "2026-10-01",
			days_in_current_status: 7,
			other_shortage_ids: [SHORTAGES.dolipraneTension.id],
			possibly_related_shortages: [],
		});
		expect(data.history).toEqual([
			{ date: "2026-10-01", change: "new", status: "tension" },
			{ date: "2026-10-20", change: "status_change", from: "tension", to: "rupture" },
			{ date: "2026-10-22", change: "return_date_change", from_raw: "Remise à disposition prévue fin octobre 2026", to_raw: MONTH_RAW },
		]);
		const s = summary(result);
		expect(s).toContain(`Expected return (ANSM wording): "${MONTH_RAW}"`);
		expect(s).not.toMatch(/2026-11-01|2026-11-30/);
		expect(s).not.toContain("has passed");
	});

	it("flags a passed return date and a probable match", async () => {
		const { data, result } = await call(getAvailability, { cis: MEDICINES.amoxicilline.cis });
		expect(data.shortage).toMatchObject({ match_confidence: 0.6, match_note: "probable match", expected_return: { passed: true, raw: PASSED_RAW } });
		expect(data.days_in_current_status).toBe(2);
		expect(summary(result)).toContain("The announced return date has passed.");
		expect(summary(result)).toContain("probable match");
	});

	it("counts days from the situation start, then first seen, without a status event", async () => {
		await env.DB.prepare("DELETE FROM status_history WHERE shortage_id = ?").bind(SHORTAGES.amoxicilline.id).run();
		await env.DB.prepare("DELETE FROM status_history WHERE shortage_id = ?").bind(SHORTAGES.zymad.id).run();
		try {
			expect((await call(getAvailability, { cis: MEDICINES.amoxicilline.cis })).data.days_in_current_status).toBe(42);
			expect((await call(getAvailability, { cis: MEDICINES.zymad.cis })).data.days_in_current_status).toBe(56);
		} finally {
			await seed();
		}
	});

	it("not listed: the exact sentence when nothing is possibly related", async () => {
		const { data, result } = await call(getAvailability, { cis: MEDICINES.kardegic.cis });
		expect(data).toMatchObject({
			kind: "availability",
			medicine: { cis: MEDICINES.kardegic.cis, is_mitm: false },
			listed: false,
			shortage: null,
			first_seen_at: null,
			days_in_current_status: null,
			history: [],
			possibly_related_shortages: [],
		});
		expect(summary(result)).toContain(
			"No shortage currently listed by ANSM for this medicine. This does not guarantee availability in your pharmacy.",
		);
		expect(summary(result)).toContain(NOT_LISTED);
	});

	it("not listed: names possibly related entries sharing the brand token", async () => {
		const { data, result } = await call(getAvailability, { cis: MEDICINES.dolipraneCapsule.cis });
		expect(data.listed).toBe(false);
		expect(data.possibly_related_shortages.map((s: { shortage_id: string }) => s.shortage_id)).toEqual([SHORTAGES.dolipraneUnmatched.id]);
		expect(summary(result)).toContain(
			`No shortage is linked to this medicine with certainty, but ANSM lists possibly related entries: ${SHORTAGES.dolipraneUnmatched.name} (tension). This does not guarantee availability in your pharmacy.`,
		);
		expect(summary(result)).not.toContain(NOT_LISTED);
	});

	it("by shortage id: best-linked medicine, or none when unmatched", async () => {
		const linked = await call(getAvailability, { shortage_id: SHORTAGES.dolipraneTension.id });
		expect(linked.data).toMatchObject({
			kind: "availability",
			medicine: { cis: MEDICINES.dolipraneTablet.cis },
			shortage: { shortage_id: SHORTAGES.dolipraneTension.id, status: "tension" },
			other_shortage_ids: [SHORTAGES.dolipraneRupture.id],
		});
		const unmatched = await call(getAvailability, { shortage_id: SHORTAGES.dolipraneUnmatched.id });
		expect(unmatched.data).toMatchObject({ medicine: null, linked_medicines: [], listed: true, shortage: { match_confidence: null } });
		const delisted = await call(getAvailability, { shortage_id: SHORTAGES.delisted.id });
		expect(delisted.data).toMatchObject({ listed: false, shortage: { shortage_id: SHORTAGES.delisted.id } });
		expect(summary(delisted.result)).toContain("no longer listed");
	});

	it("by name: resolves one, lists candidates, or not_found", async () => {
		const one = await call(getAvailability, { name: "kardegic" });
		expect(one.data).toMatchObject({ kind: "availability", medicine: { cis: MEDICINES.kardegic.cis } });
		const exact = await call(getAvailability, { name: MEDICINES.dolipraneCapsule.name });
		expect(exact.data).toMatchObject({ kind: "availability", medicine: { cis: MEDICINES.dolipraneCapsule.cis } });
		const many = await call(getAvailability, { name: "doliprane" });
		expect(many.data.kind).toBe("candidates");
		expect(many.data.candidates).toHaveLength(2);
		expect(many.data.candidates).toEqual(
			expect.arrayContaining([
				{ cis: MEDICINES.dolipraneTablet.cis, name: MEDICINES.dolipraneTablet.name },
				{ cis: MEDICINES.dolipraneCapsule.cis, name: MEDICINES.dolipraneCapsule.name },
			]),
		);
		expect(summary(many.result)).toContain('Several medicines match "doliprane"; call again with one cis.');
		const none = await call(getAvailability, { name: "zzzunknown" });
		expect(none.data).toEqual({ kind: "not_found", possibly_related_shortages: [] });
		expect(summary(none.result)).toContain("Check the spelling or search by active substance");
	});

	it("by name, not_found: lists unmatched entries sharing the query's brand token", async () => {
		await env.DB.prepare(
			`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, scope, scope_raw, ansm_updated_at, list_hash, first_seen_at, last_seen_at, listed)
			VALUES ('1009', '/disponibilites-des-produits-de-sante/medicaments/entry-1009', 'COLI-GENTA AP-HP', ?, 'rupture', 'Rupture de stock', 'hopital', 'Hôpital', '2026-10-23', 'h', ?, ?, 1)`,
		)
			.bind(normalize("COLI-GENTA AP-HP"), "2026-10-23T05:00:00.000Z", ANSM_LAST_INGEST)
			.run();
		try {
			const { data, result } = await call(getAvailability, { name: "coli-genta injectable" });
			expect(data.kind).toBe("not_found");
			expect(data.possibly_related_shortages).toHaveLength(1);
			expect(data.possibly_related_shortages[0]).toMatchObject({ shortage_id: "1009", name: "COLI-GENTA AP-HP", status: "rupture", match_confidence: null });
			expect(summary(result)).toContain("ANSM lists possibly related entries: COLI-GENTA AP-HP (rupture). This does not guarantee availability in your pharmacy.");
			expect((await call(getAvailability, { name: "co injectable" })).data).toEqual({ kind: "not_found", possibly_related_shortages: [] });
		} finally {
			await seed();
		}
	});

	it("not_found: unknown CIS, unknown shortage id", async () => {
		expect((await call(getAvailability, { cis: "69999999" })).data).toEqual({ kind: "not_found", possibly_related_shortages: [] });
		expect((await call(getAvailability, { shortage_id: "999999" })).data).toEqual({ kind: "not_found", possibly_related_shortages: [] });
	});
});

describe("list_current_shortages", () => {
	it("applies the defaults and bounds of its input", () => {
		expect(listCurrentShortages.inputSchema.parse({})).toEqual({ status: ["rupture", "tension"], limit: 25, offset: 0 });
		expect(listCurrentShortages.inputSchema.safeParse({ limit: 51 }).success).toBe(false);
		expect(listCurrentShortages.inputSchema.safeParse({ offset: 10001 }).success).toBe(false);
		expect(listCurrentShortages.inputSchema.safeParse({ updated_since: "2026-13-01" }).success).toBe(false);
		expect(listCurrentShortages.inputSchema.safeParse({ therapeutic_area: "a" }).success).toBe(false);
	});

	it("lists listed rupture and tension entries, latest update first, with best-match CIS", async () => {
		const { data } = await call(listCurrentShortages, {});
		expect(data.kind).toBe("list");
		expect(data.total).toBe(4);
		expect(data.items.map((i: { shortage_id: string }) => i.shortage_id)).toEqual(["1006", "1002", "1005", "1001"]);
		expect(data.items[0].cis).toEqual([MEDICINES.dolipraneTablet.cis]);
		expect(data.items[2].cis).toEqual([]);
		expect(data.next_offset).toBeNull();
	});

	it("pages with next_offset", async () => {
		const first = await call(listCurrentShortages, { limit: 3 });
		expect(first.data).toMatchObject({ total: 4, next_offset: 3 });
		const last = await call(listCurrentShortages, { limit: 3, offset: 3 });
		expect(last.data.items.map((i: { shortage_id: string }) => i.shortage_id)).toEqual(["1001"]);
		expect(last.data.next_offset).toBeNull();
	});

	it("scope: ville and hopital include ville_hopital, the others match exactly", async () => {
		const status = ["rupture", "tension", "arret_commercialisation", "remise_a_disposition", "autre"] as const;
		const ids = async (scope: "ville" | "hopital" | "ville_hopital" | "inconnu") =>
			(await call(listCurrentShortages, { status: [...status], scope })).data.items.map((i: { shortage_id: string }) => i.shortage_id).sort();
		expect(await ids("hopital")).toEqual(["1002", "1004"]);
		expect(await ids("ville")).toEqual(["1001", "1003", "1004", "1005", "1006"]);
		expect(await ids("ville_hopital")).toEqual(["1004"]);
		expect(await ids("inconnu")).toEqual(["1007"]);
	});

	it("filters by therapeutic area and update date", async () => {
		const area = await call(listCurrentShortages, { status: ["rupture", "tension", "remise_a_disposition"], therapeutic_area: "gastro" });
		expect(area.data.items.map((i: { shortage_id: string }) => i.shortage_id)).toEqual(["1004"]);
		const since = await call(listCurrentShortages, { updated_since: "2026-10-25" });
		expect(since.data.items.map((i: { shortage_id: string }) => i.shortage_id)).toEqual(["1006", "1002"]);
	});

	it("returns an empty list when the therapeutic area normalizes to nothing", async () => {
		const { data } = await call(listCurrentShortages, { therapeutic_area: "--" });
		expect(data).toEqual({ kind: "list", total: 0, items: [], next_offset: null });
	});
});

describe("recent_changes", () => {
	it("applies the defaults and bounds of its input", () => {
		expect(recentChanges.inputSchema.parse({})).toEqual({
			days: 7,
			change_types: ["new", "status_change", "return_date_change", "delisted", "relisted"],
			limit: 50,
		});
		expect(recentChanges.inputSchema.safeParse({ days: 91 }).success).toBe(false);
		expect(recentChanges.inputSchema.safeParse({ days: 0 }).success).toBe(false);
	});

	it("returns the window, counts with all keys, items latest first and the note", async () => {
		const { data } = await call(recentChanges, {});
		expect(data.since).toBe("2026-10-20T12:00:00.000Z");
		expect(data.counts).toEqual({ new: 1, status_change: 0, return_date_change: 1, delisted: 1, relisted: 0 });
		expect(data.items.map((i: { shortage_id: string; change: string }) => `${i.shortage_id}:${i.change}`)).toEqual([
			"1008:delisted",
			"1002:new",
			"1001:return_date_change",
		]);
		expect(data.items[2]).toMatchObject({
			date: "2026-10-22T05:00:00.000Z",
			name: SHORTAGES.dolipraneRupture.name,
			ansm_url: `https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/entry-1001`,
			old_expected_return: "Remise à disposition prévue fin octobre 2026",
			new_expected_return: MONTH_RAW,
		});
		expect(data.note).toBe(CHANGES_NOTE);
	});

	it("filters by change type and limit; counts stay over the whole window", async () => {
		const { data } = await call(recentChanges, { days: 90, change_types: ["new"], limit: 1 });
		expect(data.counts).toEqual({ new: 3, status_change: 1, return_date_change: 1, delisted: 1, relisted: 0 });
		expect(data.items.map((i: { shortage_id: string }) => i.shortage_id)).toEqual(["1002"]);
	});
});

describe("is_major_therapeutic_interest", () => {
	it("requires exactly one argument, with the source line", async () => {
		for (const args of [{}, { cis: MEDICINES.kardegic.cis, name: "kardegic" }]) {
			const { result } = await call(isMajorTherapeuticInterest, args);
			expect(result.isError).toBe(true);
			expect(text(result)).toBe(`Provide exactly one of cis or name.\n${SAFETY_LINE}\n${SOURCE_LINE}`);
		}
	});

	it("returns the argument error with unknown dates when the source dates fail to load", async () => {
		const args = isMajorTherapeuticInterest.inputSchema.parse({ cis: MEDICINES.kardegic.cis, name: "kardegic" });
		const { result } = await isMajorTherapeuticInterest.handler({ db: brokenDb(), now: NOW }, args);
		expect(result).toEqual({ isError: true, content: [{ type: "text", text: `Provide exactly one of cis or name.\n${SAFETY_LINE}\n${UNKNOWN_SOURCE_LINE}` }] });
	});

	it("mitm variant with the release-dated source and the MITM sentence", async () => {
		const yes = await call(isMajorTherapeuticInterest, { cis: MEDICINES.dolipraneTablet.cis });
		expect(yes.data).toEqual({
			kind: "mitm",
			cis: MEDICINES.dolipraneTablet.cis,
			name: MEDICINES.dolipraneTablet.name,
			is_mitm: true,
			atc_code: "N02BE01",
			source: `BDPM MITM list, release ${BDPM_RELEASE}`,
		});
		expect(summary(yes.result)).toContain(MITM_DEFINITION);
		const no = await call(isMajorTherapeuticInterest, { name: "kardegic" });
		expect(no.data).toMatchObject({ kind: "mitm", is_mitm: false, atc_code: null });
		expect(summary(no.result)).toContain(MITM_DEFINITION);
	});

	it("candidates and not_found variants", async () => {
		expect((await call(isMajorTherapeuticInterest, { name: "doliprane" })).data.kind).toBe("candidates");
		expect((await call(isMajorTherapeuticInterest, { cis: "69999999" })).data).toEqual({ kind: "not_found", possibly_related_shortages: [] });
		expect((await call(isMajorTherapeuticInterest, { name: "doliprane suppositoire" })).data).toEqual({
			kind: "not_found",
			possibly_related_shortages: [],
		});
	});
});

describe("get_medicine_info", () => {
	const { dolipraneBoxOf8: box8, dolipraneBoxOf100: box100, dolipraneStopped: stopped } = PRESENTATIONS;
	const cips = (data: { presentations: Array<{ cip13: string }> }) => data.presentations.map((p) => p.cip13);

	it("requires exactly one argument, with the source line", async () => {
		for (const args of [{}, { cis: MEDICINES.dolipraneTablet.cis, cip13: box8.cip13 }, { cip13: box8.cip13, name: "doliprane" }]) {
			const { result } = await call(getMedicineInfo, args);
			expect(result.isError).toBe(true);
			expect(text(result)).toBe(`Provide exactly one of cis, cip13 or name.\n${SAFETY_LINE}\n${SOURCE_LINE}`);
		}
		expect(getMedicineInfo.inputSchema.safeParse({ cip13: "340093000001" }).success).toBe(false);
		expect(getMedicineInfo.inputSchema.safeParse({ cis: "6000000" }).success).toBe(false);
	});

	it("has the description and the info-only suffix", () => {
		expect(getMedicineInfo.description).toBe(
			"Boxes of a medicine in the French public medicines database (BDPM), its prescription and dispensing conditions and its current ANSM safety information, given exactly one of its CIS code, a CIP13 barcode or its name. Each box has its CIP13, marketing status, price and reimbursement rate. " +
				"Public data for information only; not medical advice.",
		);
	});

	it("info by CIS: identity, marketed presentations first then by label", async () => {
		const { data, result } = await call(getMedicineInfo, { cis: MEDICINES.dolipraneTablet.cis });
		expect(data.kind).toBe("info");
		expect(data.medicine).toEqual({
			cis: MEDICINES.dolipraneTablet.cis,
			name: MEDICINES.dolipraneTablet.name,
			form: "comprimé",
			routes: null,
			holder: null,
			marketing_status: null,
			is_mitm: true,
		});
		expect(Medicine.strict().safeParse(data.medicine).success).toBe(true);
		for (const p of data.presentations) expect(Presentation.strict().safeParse(p).success).toBe(true);
		expect(cips(data)).toEqual([box100.cip13, box8.cip13, stopped.cip13]);
		expect(data.presentations[2]).toEqual({
			cip13: stopped.cip13,
			cip7: stopped.cip13.slice(5, 12),
			label: stopped.label,
			admin_status: "Présentation active",
			marketing_status: stopped.marketing_status,
			declared_at: "2011-03-16",
			hospital_approval: true,
			reimbursement_rates: [100, 65],
			price_eur: null,
			public_price_eur: 1.5,
			dispensing_fee_eur: null,
			reimbursement_indications: null,
		});
		expect(summary(result).split("\n").slice(0, 3)).toEqual([
			`${MEDICINES.dolipraneTablet.name} (CIS ${MEDICINES.dolipraneTablet.cis}): 2 marketed box(es) out of 3.`,
			`- ${box100.label} (CIP13 ${box100.cip13}): price not listed; not reimbursed / not listed.`,
			`- ${box8.label} (CIP13 ${box8.cip13}): public price 2.18 EUR; reimbursed 65%.`,
		]);
		expect(summary(result)).not.toContain(stopped.cip13);
	});

	it("info by CIP13: the matching presentation comes first", async () => {
		const { data: byCis } = await call(getMedicineInfo, { cis: MEDICINES.dolipraneTablet.cis });
		const second = byCis.presentations[1].cip13 as string;
		const { data, result } = await call(getMedicineInfo, { cip13: second });
		expect(data.kind).toBe("info");
		expect(data.medicine.cis).toBe(MEDICINES.dolipraneTablet.cis);
		expect(cips(data)).toEqual([second, ...cips(byCis).filter((c: string) => c !== second)]);
		expect(cips((await call(getMedicineInfo, { cip13: stopped.cip13 })).data)[0]).toBe(stopped.cip13);
		const ordered = (code: string | null) => loadInfo(env.DB, MEDICINES.dolipraneTablet.cis, code, "2026-10-27").then((i) => i.presentations.map((p) => p.cip13));
		expect(await ordered(null)).toEqual(cips(byCis));
		expect(await ordered(stopped.cip13)).toEqual([stopped.cip13, box100.cip13, box8.cip13]);
		const { result: raw } = await getMedicineInfo.handler(ctx, getMedicineInfo.inputSchema.parse({ cip13: second }));
		expect(raw).toEqual(result);
		expect((await getMedicineInfo.handler(ctx, getMedicineInfo.inputSchema.parse({ cip13: second }))).cis).toBe(MEDICINES.dolipraneTablet.cis);
	});

	it("info by name; a medicine without presentations has an empty list", async () => {
		const { data } = await call(getMedicineInfo, { name: "amoxicilline" });
		expect(data).toMatchObject({ kind: "info", medicine: { cis: MEDICINES.amoxicilline.cis }, presentations: [] });
	});

	it("takes the identity from the BDPM medicine, by CIS and by name", async () => {
		const { cis, name } = MEDICINES.amoxicilline;
		await env.DB.prepare("UPDATE medicines SET routes = 'orale', holder = 'BIOGARAN', marketing_status = 'Commercialisée' WHERE cis = ?").bind(cis).run();
		try {
			const identity = { cis, name, form: "gélule", routes: "orale", holder: "BIOGARAN", marketing_status: "Commercialisée", is_mitm: true };
			expect((await call(getMedicineInfo, { cis })).data.medicine).toEqual(identity);
			expect((await call(getMedicineInfo, { name: "amoxicilline" })).data.medicine).toEqual(identity);
			expect((await call(getMedicineInfo, { cis: MEDICINES.kardegic.cis })).data.medicine.is_mitm).toBe(false);
		} finally {
			await env.DB.prepare("UPDATE medicines SET routes = NULL, holder = NULL, marketing_status = NULL WHERE cis = ?").bind(cis).run();
		}
	});

	it("returns the BDPM prescription and dispensing conditions verbatim, in source order", async () => {
		const conditions = PRESCRIPTION_CONDITIONS[MEDICINES.amoxicilline.cis];
		for (const args of [{ cis: MEDICINES.amoxicilline.cis }, { name: "amoxicilline" }]) {
			const { data, result } = await call(getMedicineInfo, args);
			expect(data.prescription_conditions).toEqual(conditions);
			expect(summary(result).split("\n")).toContain(
				"Prescription and dispensing conditions (BDPM): liste I; médicament nécessitant une surveillance particulière pendant le traitement",
			);
			expect(summary(result)).not.toContain("No prescription or dispensing condition");
			expect(Data.safeParse(data).success).toBe(true);
		}
	});

	it("has an empty conditions list and says so when the BDPM lists none", async () => {
		for (const args of [{ cis: MEDICINES.dolipraneTablet.cis }, { cip13: PRESENTATIONS.dolipraneBoxOf8.cip13 }]) {
			const { data, result } = await call(getMedicineInfo, args);
			expect(data.prescription_conditions).toEqual([]);
			expect(summary(result).split("\n")).toContain("No prescription or dispensing condition listed in the BDPM.");
			expect(summary(result)).not.toContain("Prescription and dispensing conditions (BDPM)");
			expect(Data.safeParse(data).success).toBe(true);
			expect(Data.safeParse({ ...data, prescription_conditions: undefined }).success).toBe(false);
			expect(Data.safeParse({ ...data, prescription_conditions: [1] }).success).toBe(false);
		}
	});

	it("reads presentations, conditions and safety information in a single D1 batch", async () => {
		const batch = vi.spyOn(env.DB, "batch");
		try {
			const info = await loadInfo(env.DB, MEDICINES.amoxicilline.cis, null, "2026-10-27");
			expect(info.presentations).toEqual([]);
			expect(info.prescription_conditions).toEqual(PRESCRIPTION_CONDITIONS[MEDICINES.amoxicilline.cis]);
			expect(info.safety_information).toHaveLength(6);
			expect(batch).toHaveBeenCalledTimes(1);
			expect(batch.mock.calls[0][0]).toHaveLength(3);
		} finally {
			batch.mockRestore();
		}
	});

	it("returns only the ANSM safety information active today (UTC), latest start first, with the safety sentence", async () => {
		const active = ["Starts today", "Current 2026-05", "Current 2026-03", "Current 2026-01", "Current 2025-02", "Ends today"];
		const byTitle = new Map(SAFETY_INFORMATION[MEDICINES.amoxicilline.cis].map((i) => [i.title, i]));
		for (const args of [{ cis: MEDICINES.amoxicilline.cis }, { name: "amoxicilline" }]) {
			const { data, result } = await call(getMedicineInfo, args);
			expect(data.safety_information).toEqual(active.map((t) => byTitle.get(t)));
			for (const item of data.safety_information) expect(SafetyInformation.strict().safeParse(item).success).toBe(true);
			expect(Data.safeParse(data).success).toBe(true);
			const line = summary(result).split("\n").find((l) => l.startsWith("ANSM safety information"));
			expect(line).toBe(
				"ANSM safety information (6): Starts today (https://ansm.sante.fr/actualites/c-start); Current 2026-05 (https://ansm.sante.fr/actualites/c5); " +
					"Current 2026-03 (https://ansm.sante.fr/actualites/c3); Current 2026-01 (https://ansm.sante.fr/actualites/c1); Current 2025-02 (http://ansm.sante.fr/Activites/c2). " +
					"See the ANSM pages for details; do not stop or change a treatment without asking your doctor or pharmacist.",
			);
			expect(summary(result)).not.toContain(NO_SAFETY_INFORMATION);
		}
		// The filter follows the UTC date: just past midnight UTC on 2026-10-28, "Ends today" has ended and "Future item" has started.
		const { data: next } = await call(getMedicineInfo, { cis: MEDICINES.amoxicilline.cis }, new Date("2026-10-28T00:30:00.000Z"));
		expect(next.safety_information.map((i: SafetyInformation) => i.title)).toEqual(["Future item", "Starts today", "Current 2026-05", "Current 2026-03", "Current 2026-01", "Current 2025-02"]);
		const { data: before } = await call(getMedicineInfo, { cis: MEDICINES.amoxicilline.cis }, new Date("2024-01-01T12:00:00.000Z"));
		expect(before.safety_information).toEqual([]);
	});

	it("has an empty safety information list and says so when none is current", async () => {
		const { data, result } = await call(getMedicineInfo, { cis: MEDICINES.dolipraneTablet.cis });
		expect(data.safety_information).toEqual([]);
		expect(summary(result).split("\n")).toContain(NO_SAFETY_INFORMATION);
		expect(summary(result)).not.toContain(SAFETY_ADVICE);
		expect(Data.safeParse(data).success).toBe(true);
		expect(Data.safeParse({ ...data, safety_information: undefined }).success).toBe(false);
		expect(Data.safeParse({ ...data, safety_information: [{ title: "x", url: "not a url", starts_on: "2026-01-01", ends_on: "2027-01-01" }] }).success).toBe(false);
		expect(Data.safeParse({ ...data, safety_information: [{ title: "x", url: "https://ansm.sante.fr/x", starts_on: "01/01/2026", ends_on: "2027-01-01" }] }).success).toBe(false);
	});

	it("caps the summary at 10 presentations and keeps the full list in structuredContent", async () => {
		const { data, result } = await call(getMedicineInfo, { cis: MEDICINES.kardegic.cis });
		expect(data.presentations).toHaveLength(12);
		const lines = summary(result).split("\n");
		expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(SUMMARY_LIMIT);
		expect(lines).toContain("2 more marketed box(es) in the structured content.");
	});

	it("candidates and not_found variants", async () => {
		expect((await call(getMedicineInfo, { name: "doliprane" })).data.kind).toBe("candidates");
		for (const args of [{ cis: "69999999" }, { cip13: "3400999999999" }, { name: "zzzunknown" }]) {
			const { data, result } = await call(getMedicineInfo, args);
			expect(data).toEqual({ kind: "not_found", possibly_related_shortages: [] });
			expect(summary(result)).toContain("Check the spelling or search by active substance");
		}
	});
});

describe("runTool", () => {
	it("records one usage data point without free text, and swallows analytics failures", async () => {
		const writeDataPoint = vi.fn();
		const res = await runTool({ DB: env.DB, USAGE: { writeDataPoint } }, getAvailability, { name: "kardegic" });
		expect(res.isError).toBeUndefined();
		expect(writeDataPoint).toHaveBeenCalledOnce();
		const point = writeDataPoint.mock.calls[0]?.[0];
		expect(point).toMatchObject({ blobs: ["get_availability", "ok", MEDICINES.kardegic.cis], indexes: ["get_availability"] });
		expect(point.doubles).toHaveLength(1);
		expect(JSON.stringify(point)).not.toContain("kardegic");

		const failing = { writeDataPoint: () => { throw new Error("ae down"); } };
		const ok = await runTool({ DB: env.DB, USAGE: failing }, searchMedicine, searchMedicine.inputSchema.parse({ query: "doliprane" }));
		expect(ok.isError).toBeUndefined();
	});

	it("records error calls without a CIS", async () => {
		const writeDataPoint = vi.fn();
		await runTool({ DB: env.DB, USAGE: { writeDataPoint } }, getAvailability, {});
		expect(writeDataPoint.mock.calls[0]?.[0].blobs).toEqual(["get_availability", "error", ""]);
	});

	it("turns a D1 error into the unavailable error result", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const info = vi.spyOn(console, "log");
		const writeDataPoint = vi.fn();
		const res = await runTool({ DB: brokenDb(), USAGE: { writeDataPoint } }, listCurrentShortages, listCurrentShortages.inputSchema.parse({}));
		expect(res).toEqual({ isError: true, content: [{ type: "text", text: `${UNAVAILABLE}\n${SAFETY_LINE}\n${UNKNOWN_SOURCE_LINE}` }] });
		expect(error).toHaveBeenCalledOnce();
		expect(JSON.parse(error.mock.calls[0]?.[0] as string)).toEqual({
			event: "tool_error",
			tool: "list_current_shortages",
			error: "Error: D1_ERROR: database unavailable",
		});
		expect(info).not.toHaveBeenCalled();
		expect(writeDataPoint.mock.calls[0]?.[0].blobs).toEqual(["list_current_shortages", "error", ""]);
	});

	it("keeps the source dates when only the tool query fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const batch = env.DB.batch.bind(env.DB);
		let calls = 0;
		const flaky = new Proxy(env.DB, {
			get(target, prop) {
				if (prop === "batch")
					return (stmts: D1PreparedStatement[]) => {
						calls++;
						if (calls === 2) throw new Error("D1_ERROR: timeout");
						return batch(stmts);
					};
				const v = Reflect.get(target, prop);
				return typeof v === "function" ? v.bind(target) : v;
			},
		});
		const res = await runTool({ DB: flaky, USAGE: { writeDataPoint: vi.fn() } }, listCurrentShortages, listCurrentShortages.inputSchema.parse({}));
		expect(res.isError).toBe(true);
		expect(text(res)).toBe(`${UNAVAILABLE}\n${SAFETY_LINE}\n${SOURCE_LINE}`);
	});
});

describe("log", () => {
	it("writes one JSON line to stdout, or to stderr at the error level", () => {
		const info = vi.spyOn(console, "log").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		log("ingest_ok", { rows: 3 });
		expect(info).toHaveBeenCalledWith('{"event":"ingest_ok","rows":3}');
		expect(error).not.toHaveBeenCalled();
		log("tool_error", { tool: "x" }, "error");
		expect(error).toHaveBeenCalledWith('{"event":"tool_error","tool":"x"}');
		expect(info).toHaveBeenCalledOnce();
	});
});
