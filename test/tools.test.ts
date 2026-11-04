import { env } from "cloudflare:workers";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as z from "zod";
import { log } from "../src/ingest/http";
import { type HistoryRow, getMedicineInfo as loadInfo, MARKETED, MEDICINE_MARKETED } from "../src/lib/db";
import { normalize } from "../src/lib/normalize";
import { ANSM_SOURCE_URL, BDPM_SOURCE_URL, COVERAGE_NOTE, DISCLAIMER, isStale, SAFETY, sourceLine } from "../src/mcp/envelope";
import { describeShortage, ean13CheckDigit, isValidEan13, Medicine, Presentation, SafetyInformation, type ShortageRow } from "../src/mcp/schemas";
import { resolveName } from "../src/mcp/resolve";
import { INFO_ONLY, NOT_FOUND_HINT, runTool, type Tool, type ToolContext, UNAVAILABLE } from "../src/mcp/tool";
import { getAvailability, LINKED_LIMIT, NOT_LISTED, statusSince } from "../src/mcp/tools/getAvailability";
import { Data, getMedicineInfo, NO_SAFETY_INFORMATION, SAFETY_ADVICE, SUMMARY_LIMIT } from "../src/mcp/tools/getMedicineInfo";
import { isMajorTherapeuticInterest, MITM_DEFINITION } from "../src/mcp/tools/isMajorTherapeuticInterest";
import { listCurrentShortages } from "../src/mcp/tools/listCurrentShortages";
import { CHANGES_NOTE, recentChanges } from "../src/mcp/tools/recentChanges";
import { SHORTAGE_NOTE, searchMedicine } from "../src/mcp/tools/searchMedicine";
import { ANSM_LAST_INGEST, BDPM_IMPORTED_AT, BDPM_RELEASE, MEDICINES, MONTH_RAW, NOW, PASSED_RAW, PRESCRIPTION_CONDITIONS, PRESENTATIONS, SAFETY_INFORMATION, SHORTAGES, seed } from "./seed";

const SOURCE_LINE = `Source: ANSM (updated 2026-10-27), BDPM (release ${BDPM_RELEASE}, imported 2026-10-05).`;
const UNKNOWN_SOURCE_LINE = "Source: ANSM (updated unknown), BDPM (release unknown, imported unknown).";
const SAFETY_LINE = `Safety: ${SAFETY}`;
/** 13 digits with a correct EAN-13 check digit, absent from the seed. */
const UNKNOWN_CIP13 = "3400999999991";
/** 13 digits with a wrong EAN-13 check digit. */
const INVALID_CIP13 = "3400999999999";

const ctx: ToolContext = { db: env.DB, now: NOW };

const text = (r: CallToolResult): string => (r.content[0] as { text: string }).text;
/** The summary part of a result's text (before the JSON). */
const summary = (r: CallToolResult): string => text(r).split("\n\n")[0] as string;
const firstLine = (r: CallToolResult): string => summary(r).split("\n")[0] as string;

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

describe("isValidEan13", () => {
	const real = PRESENTATIONS.dolipraneBoxOf8.cip13;

	it("accepts a real CIP13 and rejects a wrong check digit or a 12-digit code", () => {
		expect(isValidEan13(real)).toBe(true);
		expect(isValidEan13(real.slice(0, 12) + String((Number(real[12]) + 1) % 10))).toBe(false);
		expect(isValidEan13(real.slice(0, 12))).toBe(false);
		expect(isValidEan13(UNKNOWN_CIP13)).toBe(true);
		expect(isValidEan13(INVALID_CIP13)).toBe(false);
	});

	it("passes every seeded CIP13", () => {
		for (const p of Object.values(PRESENTATIONS)) expect(isValidEan13(p.cip13), p.cip13).toBe(true);
	});
});

describe("envelope", () => {
	it("carries the fixed safety notice", () => {
		expect(SAFETY).toBe(
			"Do not use this data to suggest a substitute, an alternative or an equivalent medicine, a dosage change or stopping a treatment. Other medicines in these results are not alternatives. Refer the user to a pharmacist or doctor.",
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
		const unknown = await call(searchMedicine, { query: UNKNOWN_CIP13 });
		expect(unknown.data.results).toEqual([]);
		expect(unknown.data).not.toHaveProperty("invalid_cip13");
	});

	it("flags a 13-digit query with a wrong check digit as an invalid barcode", async () => {
		const { data, result } = await call(searchMedicine, { query: INVALID_CIP13 });
		expect(data).toMatchObject({ results: [], unmatched_shortages: [], invalid_cip13: true });
		expect(summary(result)).not.toContain(NOT_FOUND_HINT);
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
		expect(getAvailability.inputSchema.safeParse({ shortage_id: "12a" }).success).toBe(false);
		expect(getAvailability.inputSchema.safeParse({ shortage_id: "1".repeat(7) }).success).toBe(false);
		expect(getAvailability.inputSchema.safeParse({ shortage_id: SHORTAGES.dolipraneRupture.id }).success).toBe(true);
		expect(getAvailability.inputSchema.safeParse({ name: "a" }).success).toBe(false);
	});

	it("availability by CIS: current shortage, history, status date, other ids, linked medicines", async () => {
		const { data, result } = await call(getAvailability, { cis: MEDICINES.dolipraneTablet.cis });
		expect(data).toMatchObject({
			kind: "availability",
			medicine: { cis: MEDICINES.dolipraneTablet.cis, name: MEDICINES.dolipraneTablet.name, is_mitm: true },
			linked_medicines: [{ cis: MEDICINES.dolipraneTablet.cis, name: MEDICINES.dolipraneTablet.name, match_confidence: 1 }],
			listed: true,
			shortage: { shortage_id: SHORTAGES.dolipraneRupture.id, status: "rupture", expected_return: { precision: "month", raw: MONTH_RAW, passed: false } },
			first_seen_at: "2026-10-01",
			status_since: "2026-10-20",
			status_since_source: "service",
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
		expect(data).toMatchObject({ status_since: SHORTAGES.amoxicilline.situation_start, status_since_source: "ansm" });
		expect(summary(result)).toContain("The announced return date has passed.");
		expect(summary(result)).toContain("probable match");
	});

	it("dates the status from the situation start, then first seen, without a status event", async () => {
		await env.DB.prepare("DELETE FROM status_history WHERE shortage_id = ?").bind(SHORTAGES.amoxicilline.id).run();
		await env.DB.prepare("DELETE FROM status_history WHERE shortage_id = ?").bind(SHORTAGES.zymad.id).run();
		try {
			const amoxicilline = await call(getAvailability, { cis: MEDICINES.amoxicilline.cis });
			expect(amoxicilline.data).toMatchObject({ status_since: SHORTAGES.amoxicilline.situation_start, status_since_source: "ansm" });
			const zymad = await call(getAvailability, { cis: MEDICINES.zymad.cis });
			expect(zymad.data).toMatchObject({ status_since: zymad.data.first_seen_at, status_since_source: "service" });
		} finally {
			await seed();
		}
	});

	it("statusSince takes the latest status change or relisting, else the ANSM situation start, else first seen", () => {
		const row = (change_type: HistoryRow["change_type"], detected_at: string): HistoryRow => ({
			change_type,
			old_status: null,
			new_status: null,
			old_expected_return: null,
			new_expected_return: null,
			detected_at,
		});
		const shortage = { situation_start: "2024-03-22", first_seen_at: "2026-10-27T19:42:46.788Z" } as ShortageRow;
		const unknownStart = { ...shortage, situation_start: null };
		const events = [row("new", "2026-10-27T19:42:46.788Z"), row("status_change", "2026-10-28T05:00:00.000Z"), row("relisted", "2026-10-30T05:00:00.000Z")];
		expect(statusSince(events, shortage)).toEqual({ date: "2026-10-30", source: "service" });
		expect(statusSince(events.slice(0, 2), shortage)).toEqual({ date: "2026-10-28", source: "service" });
		const noStatusEvent = [row("new", "2026-10-28T05:00:00.000Z"), row("return_date_change", "2026-10-31T05:00:00.000Z"), row("delisted", "2026-11-01T05:00:00.000Z")];
		expect(statusSince(noStatusEvent, shortage)).toEqual({ date: "2024-03-22", source: "ansm" });
		expect(statusSince(noStatusEvent, unknownStart)).toEqual({ date: "2026-10-27", source: "service" });
	});

	it("not listed: the exact sentence when nothing is possibly related", async () => {
		const { data, result } = await call(getAvailability, { cis: MEDICINES.kardegic.cis });
		expect(data).toMatchObject({
			kind: "availability",
			medicine: { cis: MEDICINES.kardegic.cis, is_mitm: false },
			listed: false,
			shortage: null,
			first_seen_at: null,
			status_since: null,
			status_since_source: null,
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
		const related = [SHORTAGES.dolipraneRupture, SHORTAGES.dolipraneTension, SHORTAGES.dolipraneUnmatched];
		expect(data.possibly_related_shortages.map((s: { shortage_id: string }) => s.shortage_id)).toEqual(related.map((s) => s.id));
		for (const s of related) expect(summary(result)).toContain(s.name);
		expect(summary(result)).not.toContain(NOT_LISTED);
	});

	it("by shortage id: no medicine for a linked entry, none when unmatched", async () => {
		const linked = await call(getAvailability, { shortage_id: SHORTAGES.dolipraneTension.id });
		expect(linked.data).toMatchObject({
			kind: "availability",
			medicine: null,
			shortage: { shortage_id: SHORTAGES.dolipraneTension.id, status: "tension" },
			other_shortage_ids: [],
		});
		const unmatched = await call(getAvailability, { shortage_id: SHORTAGES.dolipraneUnmatched.id });
		expect(unmatched.data).toMatchObject({ medicine: null, linked_medicines: [], listed: true, shortage: { match_confidence: null } });
		const delisted = await call(getAvailability, { shortage_id: SHORTAGES.delisted.id });
		expect(delisted.data).toMatchObject({ listed: false, shortage: { shortage_id: SHORTAGES.delisted.id } });
		expect(summary(delisted.result)).toContain("no longer listed");
	});

	it("by shortage id: no medicine is picked for an entry linked to several medicines", async () => {
		const entry = SHORTAGES.dolipraneTension;
		await env.DB.prepare("INSERT INTO shortage_matches (shortage_id, cis, method, confidence, is_best) VALUES (?, ?, 'exact', 1, 1)")
			.bind(entry.id, MEDICINES.dolipraneCapsule.cis)
			.run();
		try {
			const { data, result } = await call(getAvailability, { shortage_id: entry.id });
			expect(data).toMatchObject({ kind: "availability", medicine: null, other_shortage_ids: [], linked_medicines_total: 2 });
			const line = firstLine(result);
			expect(line).toContain(entry.id);
			expect(line).toContain(entry.name);
			expect(line).not.toContain(MEDICINES.dolipraneTablet.cis);
			expect(line).not.toContain(MEDICINES.dolipraneCapsule.cis);
			// The entry label (before the shortage name, id removed) reports the link count, unlike an unmatched entry's.
			const label = (l: string, s: { id: string; name: string }) => l.slice(0, l.indexOf(s.name)).replace(s.id, "");
			const unmatched = SHORTAGES.dolipraneUnmatched;
			const linkedLabel = label(line, entry);
			const unmatchedLabel = label(firstLine((await call(getAvailability, { shortage_id: unmatched.id })).result), unmatched);
			expect(linkedLabel).toContain(String(data.linked_medicines_total));
			expect(unmatchedLabel).not.toContain(String(data.linked_medicines_total));
			expect(linkedLabel).not.toBe(unmatchedLabel);
		} finally {
			await seed();
		}
	});

	it("by name: resolves one, lists candidates, or not_found", async () => {
		const one = await call(getAvailability, { name: "kardegic" });
		expect(one.data).toMatchObject({ kind: "availability", medicine: { cis: MEDICINES.kardegic.cis } });
		const exact = await call(getAvailability, { name: MEDICINES.dolipraneCapsule.name });
		expect(exact.data).toMatchObject({ kind: "availability", medicine: { cis: MEDICINES.dolipraneCapsule.cis } });
		const many = await call(getAvailability, { name: "doliprane" });
		expect(many.data.kind).toBe("candidates");
		expect(many.data.candidates).toHaveLength(2);
		expect(many.data).toMatchObject({ total: 2, capped: false });
		expect(many.data.candidates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ cis: MEDICINES.dolipraneTablet.cis, name: MEDICINES.dolipraneTablet.name, shortage_status: "rupture" }),
				expect.objectContaining({ cis: MEDICINES.dolipraneCapsule.cis, name: MEDICINES.dolipraneCapsule.name, shortage_status: null }),
			]),
		);
		const none = await call(getAvailability, { name: "zzzunknown" });
		expect(none.data).toEqual({ kind: "not_found", possibly_related_shortages: [], did_you_mean: null });
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
			expect((await call(getAvailability, { name: "co injectable" })).data).toEqual({ kind: "not_found", possibly_related_shortages: [], did_you_mean: null });
		} finally {
			await seed();
		}
	});

	it("not_found: unknown CIS, unknown shortage id", async () => {
		expect((await call(getAvailability, { cis: "69999999" })).data).toEqual({ kind: "not_found", possibly_related_shortages: [], did_you_mean: null });
		const unknownId = await call(getAvailability, { shortage_id: "999999" });
		expect(unknownId.data).toEqual({ kind: "not_found", possibly_related_shortages: [], did_you_mean: null });
		expect(summary(unknownId.result)).not.toContain(NOT_FOUND_HINT);
	});

	it("caps linked_medicines and reports the full count", async () => {
		const total = LINKED_LIMIT + 1;
		const cis = Array.from({ length: total }, (_, i) => String(61_000_000 + i));
		const stmts = [
			env.DB.prepare(
				`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, scope, scope_raw, ansm_updated_at, list_hash, first_seen_at, last_seen_at, listed)
				VALUES ('1010', '/disponibilites-des-produits-de-sante/medicaments/entry-1010', 'GAMME Y', ?, 'rupture', 'Rupture de stock', 'ville', 'Ville', '2026-10-23', 'h', ?, ?, 1)`,
			).bind(normalize("GAMME Y"), "2026-10-23T05:00:00.000Z", ANSM_LAST_INGEST),
			...cis.flatMap((c, i) => [
				env.DB.prepare("INSERT INTO medicines (cis, denomination, denomination_norm, form, bdpm_updated_at) VALUES (?, ?, ?, 'comprimé', ?)").bind(
					c,
					`GAMME Y ${i} mg, comprimé`,
					normalize(`GAMME Y ${i} mg, comprimé`),
					BDPM_RELEASE,
				),
				env.DB.prepare("INSERT INTO shortage_matches (shortage_id, cis, method, confidence, is_best) VALUES ('1010', ?, 'exact', 1, 1)").bind(c),
			]),
		];
		await env.DB.batch(stmts);
		try {
			const { data } = await call(getAvailability, { shortage_id: "1010" });
			expect(data.linked_medicines).toHaveLength(LINKED_LIMIT);
			expect(data.linked_medicines.map((m: { cis: string }) => m.cis)).toEqual(cis.slice(0, LINKED_LIMIT));
			expect(data.linked_medicines_total).toBe(total);
		} finally {
			await seed();
		}
		const none = await call(getAvailability, { cis: MEDICINES.kardegic.cis });
		expect(none.data).toMatchObject({ shortage: null, linked_medicines: [], linked_medicines_total: 0 });
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
		expect(area.data).not.toHaveProperty("available_areas");
		const since = await call(listCurrentShortages, { updated_since: "2026-10-25" });
		expect(since.data.items.map((i: { shortage_id: string }) => i.shortage_id)).toEqual(["1006", "1002"]);
	});

	it("lists the areas in use only when the therapeutic area matches no listed entry", async () => {
		const labels = [
			...new Set(
				(Object.values(SHORTAGES) as Array<{ areas?: string; listed?: number }>)
					.filter((s) => s.listed !== 0 && s.areas !== undefined)
					.flatMap((s) => (s.areas as string).split(", ")),
			),
		].sort((a, b) => a.localeCompare(b, "fr"));
		const unknown = await call(listCurrentShortages, { therapeutic_area: "zzzunknown" });
		expect(unknown.data).toMatchObject({ total: 0, items: [], available_areas: labels });
		const filteredOut = await call(listCurrentShortages, { status: ["rupture"], therapeutic_area: "gastro" });
		expect(filteredOut.data.total).toBe(0);
		expect(filteredOut.data).not.toHaveProperty("available_areas");
	});

	it("available_areas splits multi-label entries, dedups labels and ignores delisted entries", async () => {
		const delistedOnly = "Ophtalmologie";
		const added = "Pneumologie";
		const repeated = SHORTAGES.amoxicilline.areas;
		const insert = (id: string, name: string, areas: string, listed: number) =>
			env.DB.prepare(
				`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, scope, scope_raw, therapeutic_areas, therapeutic_areas_norm, ansm_updated_at, list_hash, first_seen_at, last_seen_at, listed)
				VALUES (?, ?, ?, ?, 'rupture', 'Rupture de stock', 'ville', 'Ville', ?, ?, '2026-10-23', 'h', ?, ?, ?)`,
			).bind(id, `/disponibilites-des-produits-de-sante/medicaments/entry-${id}`, name, normalize(name), areas, normalize(areas), "2026-10-23T05:00:00.000Z", ANSM_LAST_INGEST, listed);
		await env.DB.batch([insert("1011", "COLLYRE Z 1 mg/ml", delistedOnly, 0), insert("1012", "SIROP W 5 mg/ml", `${added}, ${repeated}`, 1)]);
		try {
			const { data } = await call(listCurrentShortages, { therapeutic_area: delistedOnly });
			expect(data.total).toBe(0);
			const areas = data.available_areas as string[];
			expect(areas.filter((a) => a === added)).toHaveLength(1);
			expect(areas.filter((a) => a === repeated)).toHaveLength(1);
			expect(areas).not.toContain(delistedOnly);
			const seeded = (Object.values(SHORTAGES) as Array<{ areas?: string; listed?: number }>)
				.filter((s) => s.listed !== 0 && s.areas !== undefined)
				.map((s) => s.areas as string);
			expect(areas).toEqual([...new Set([...seeded, added])].sort((a, b) => a.localeCompare(b, "fr")));
		} finally {
			await seed();
		}
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
		expect(recentChanges.inputSchema.safeParse({ change_types: [] }).success).toBe(false);
	});

	it("returns the window, counts with all keys, items latest first and the note", async () => {
		const { data } = await call(recentChanges, {});
		expect(data.since).toBe("2026-10-20T12:00:00.000Z");
		expect(data.counts).toEqual({ new: 1, status_change: 0, return_date_change: 1, delisted: 1, relisted: 0 });
		expect(data.tracking_since).toBe(ANSM_LAST_INGEST);
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

	it("filters items and counts by change type; the limit applies to items only", async () => {
		const { data } = await call(recentChanges, { days: 90, change_types: ["new"], limit: 1 });
		expect(data.counts).toEqual({ new: 3 });
		expect(data.items.map((i: { shortage_id: string }) => i.shortage_id)).toEqual(["1002"]);
	});

	it("returns the end of the earliest successful ANSM run as tracking_since, and says when the window starts before it", async () => {
		const earliest = "2026-10-10T05:10:00.000Z";
		await env.DB.batch([
			env.DB.prepare("INSERT INTO ingest_runs (source, started_at, finished_at, status) VALUES ('ansm', ?, ?, 'ok')").bind("2026-10-10T05:00:00.000Z", earliest),
			env.DB.prepare("INSERT INTO ingest_runs (source, started_at, finished_at, status) VALUES ('ansm', ?, ?, 'error')").bind("2026-10-01T05:00:00.000Z", "2026-10-01T05:10:00.000Z"),
			env.DB.prepare("INSERT INTO ingest_runs (source, started_at, finished_at, status) VALUES ('bdpm', ?, ?, 'ok')").bind("2026-09-01T05:00:00.000Z", "2026-09-01T05:10:00.000Z"),
		]);
		try {
			const before = await call(recentChanges, { days: 30 });
			expect(before.data.tracking_since).toBe(earliest);
			expect(Date.parse(before.data.since)).toBeLessThan(Date.parse(earliest));
			expect(firstLine(before.result)).toContain(earliest.slice(0, 10));

			const after = await call(recentChanges, { days: 7 });
			expect(after.data.tracking_since).toBe(earliest);
			expect(Date.parse(after.data.since)).toBeGreaterThan(Date.parse(earliest));
			expect(firstLine(after.result)).not.toContain(earliest.slice(0, 10));

			await env.DB.prepare("DELETE FROM ingest_runs WHERE source = 'ansm'").run();
			const none = await call(recentChanges, { days: 7 });
			expect(none.data.tracking_since).toBeNull();
			expect(firstLine(none.result).length).toBeGreaterThan(firstLine(after.result).length);
		} finally {
			await seed();
		}
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
		expect((await call(isMajorTherapeuticInterest, { cis: "69999999" })).data).toEqual({ kind: "not_found", possibly_related_shortages: [], did_you_mean: null });
		expect((await call(isMajorTherapeuticInterest, { name: "doliprane suppositoire" })).data).toEqual({
			kind: "not_found",
			possibly_related_shortages: [],
			did_you_mean: null,
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
		expect(getMedicineInfo.inputSchema.safeParse({ cip13: INVALID_CIP13 }).success).toBe(false);
		expect(getMedicineInfo.inputSchema.safeParse({ cis: "6000000" }).success).toBe(false);
	});

	it("has the description and the info-only suffix", () => {
		expect(getMedicineInfo.description.endsWith(INFO_ONLY)).toBe(true);
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
		const lines = summary(result).split("\n");
		expect([lines[0], lines[2], lines[3]]).toEqual([
			`${MEDICINES.dolipraneTablet.name} (CIS ${MEDICINES.dolipraneTablet.cis}): 2 marketed box(es) out of 3.`,
			`- ${box100.label} (CIP13 ${box100.cip13}): price not listed; not reimbursed / not listed.`,
			`- ${box8.label} (CIP13 ${box8.cip13}): public price 2.18 EUR; reimbursed 65%.`,
		]);
		expect(lines[1]).toContain(describeShortage(data.ansm_shortage));
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

	it("get_medicine_info: a marketed medicine linked to an ANSM marketing stop reports the entry and a status conflict", async () => {
		const first12 = "340093000005";
		const cip13 = `${first12}${ean13CheckDigit(first12)}`;
		expect(isValidEan13(cip13)).toBe(true);
		await env.DB.prepare(
			"INSERT INTO presentations (cip13, cip7, cis, label, admin_status, marketing_status, declared_at, hospital_approval, reimbursement_rates, public_price_eur) VALUES (?, ?, ?, 'ampoule(s) de 2 ml', 'Présentation active', ?, '2011-03-16', 1, '[65]', 2.5)",
		)
			.bind(cip13, cip13.slice(5, 12), MEDICINES.zymad.cis, MARKETED)
			.run();
		try {
			for (const args of [{ cis: MEDICINES.zymad.cis }, { cip13 }, { name: "zymad" }]) {
				const { data, result } = await call(getMedicineInfo, args);
				expect(data.kind).toBe("info");
				expect(data.ansm_shortage).toMatchObject({ shortage_id: SHORTAGES.zymad.id, status: "arret_commercialisation" });
				expect(typeof data.status_conflict).toBe("string");
				expect(data.status_conflict).toContain(SHORTAGES.zymad.id);
				expect(summary(result).split("\n")).toContain(data.status_conflict);
			}
		} finally {
			await seed();
		}
	});

	it("reports the first-ranked linked ANSM entry, with no status conflict without a marketing stop", async () => {
		const { data, result } = await call(getMedicineInfo, { cis: MEDICINES.dolipraneTablet.cis });
		expect(data.ansm_shortage).toMatchObject({ shortage_id: SHORTAGES.dolipraneRupture.id, status: "rupture" });
		expect(data.status_conflict).toBeNull();
		expect(summary(result)).toContain(describeShortage(data.ansm_shortage));
	});

	it("reports a status conflict when a non-first linked entry is a marketing stop", async () => {
		const id = "1010";
		const name = "PARACETAMOL TEST 1000 mg, comprimé";
		await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, scope, scope_raw, situation_start, ansm_updated_at, list_hash, first_seen_at, last_seen_at, listed)
				VALUES (?, ?, ?, ?, 'arret_commercialisation', 'Arrêt de commercialisation', 'ville', 'Ville', '2026-09-01', '2026-10-21', 'h', ?, ?, 1)`,
			).bind(id, `/disponibilites-des-produits-de-sante/medicaments/entry-${id}`, name, normalize(name), "2026-09-01T05:00:00.000Z", ANSM_LAST_INGEST),
			env.DB.prepare("INSERT INTO shortage_matches (shortage_id, cis, method, confidence, is_best) VALUES (?, ?, 'exact', 1, 1)").bind(id, MEDICINES.dolipraneTablet.cis),
		]);
		try {
			const { data, result } = await call(getMedicineInfo, { cis: MEDICINES.dolipraneTablet.cis });
			expect(data.ansm_shortage).toMatchObject({ shortage_id: SHORTAGES.dolipraneRupture.id, status: "rupture" });
			expect(typeof data.status_conflict).toBe("string");
			expect(data.status_conflict).toContain(id);
			expect(summary(result).split("\n")).toContain(data.status_conflict);
		} finally {
			await seed();
		}
	});

	it("has no status conflict for a marketing stop without a marketed box", async () => {
		const { data, result } = await call(getMedicineInfo, { cis: MEDICINES.zymad.cis });
		expect(data).toMatchObject({ presentations: [], ansm_shortage: { shortage_id: SHORTAGES.zymad.id, status: "arret_commercialisation" }, status_conflict: null });
		expect(summary(result)).toContain(describeShortage(data.ansm_shortage));
	});

	it("has a null ANSM shortage for a medicine with no linked listed entry", async () => {
		const { data, result } = await call(getMedicineInfo, { cis: MEDICINES.dolipraneCapsule.cis });
		expect(data).toMatchObject({ ansm_shortage: null, status_conflict: null });
		expect(summary(result)).not.toContain(SHORTAGES.dolipraneUnmatched.name);
	});

	it("candidates and not_found variants", async () => {
		expect((await call(getMedicineInfo, { name: "doliprane" })).data.kind).toBe("candidates");
		for (const args of [{ cis: "69999999" }, { cip13: UNKNOWN_CIP13 }, { name: "zzzunknown" }]) {
			const { data, result } = await call(getMedicineInfo, args);
			expect(data).toEqual({ kind: "not_found", possibly_related_shortages: [], did_you_mean: null });
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

describe("name search across tools", () => {
	const levothyroxine = "LÉVOTHYROXINE SODIQUE";
	const extra: Array<{ cis: string; name: string; substance: string; holder: string; marketing_status: string; link?: string; atc?: string }> = [
		{ cis: "60100001", name: "LEVOTHYROX 100 microgrammes, comprimé sécable", substance: levothyroxine, holder: "MERCK", marketing_status: MEDICINE_MARKETED },
		{ cis: "60100002", name: "THYROFIX 100 microgrammes, comprimé", substance: levothyroxine, holder: "UNIPHARMA", marketing_status: MEDICINE_MARKETED },
		{ cis: "60100003", name: "LEVOTHYROX 50 microgrammes, comprimé sécable", substance: levothyroxine, holder: "MERCK", marketing_status: MEDICINE_MARKETED },
		{ cis: "60100004", name: "LEVOTHYROX 75 microgrammes, comprimé sécable", substance: levothyroxine, holder: "MERCK", marketing_status: MEDICINE_MARKETED },
		{ cis: "60100005", name: "TESTBRAND 10 mg, comprimé", substance: "TESTINE", holder: "LAB A", marketing_status: MEDICINE_MARKETED, link: SHORTAGES.dolipraneRupture.id },
		{ cis: "60100006", name: "TESTBRAND 20 mg, comprimé", substance: "TESTINE", holder: "LAB A", marketing_status: MEDICINE_MARKETED, link: SHORTAGES.dolipraneRupture.id },
		{ cis: "60100007", name: "OTHERBRAND 10 mg, comprimé", substance: "OTHERINE", holder: "LAB B", marketing_status: MEDICINE_MARKETED, link: SHORTAGES.dolipraneRupture.id },
		{ cis: "60100008", name: "OTHERBRAND 20 mg, comprimé", substance: "OTHERINE", holder: "LAB C", marketing_status: "Non commercialisée", link: SHORTAGES.dolipraneTension.id },
		{ cis: "60100009", name: "PARACETAMOL TEST 500 mg, comprimé", substance: "PARACÉTAMOL", holder: "LAB D", marketing_status: MEDICINE_MARKETED },
		{ cis: "60100010", name: "IOMERONTEST 250 mg, solution injectable", substance: "IOMEPROL", holder: "LAB E", marketing_status: MEDICINE_MARKETED },
		{ cis: "60100011", name: "IOMERONTEST 350 mg, solution injectable", substance: "IOMEPROL", holder: "LAB E", marketing_status: MEDICINE_MARKETED },
		// Same ATC code; the marketed one has the larger CIS, so rank order differs from CIS order.
		{ cis: "60100012", name: "RANKBRAND 10 mg, comprimé", substance: "RANKINE", holder: "LAB F", marketing_status: "Non commercialisée", atc: "N05AH04" },
		{ cis: "60100013", name: "RANKBRAND 20 mg, comprimé", substance: "RANKINE", holder: "LAB F", marketing_status: MEDICINE_MARKETED, atc: "N05AH04" },
		// Both MITM, with different ATC codes.
		{ cis: "60100014", name: "SPLITBRAND 10 mg, comprimé", substance: "SPLITINE", holder: "LAB G", marketing_status: MEDICINE_MARKETED, atc: "A10BA02" },
		{ cis: "60100015", name: "SPLITBRAND 20 mg, comprimé", substance: "SPLITINE", holder: "LAB G", marketing_status: MEDICINE_MARKETED, atc: "A10BB01" },
		// One more than LINKED_LIMIT medicines sharing a brand, none on the MITM list.
		...Array.from({ length: LINKED_LIMIT + 1 }, (_, i) => ({
			cis: String(60100100 + i),
			name: `LIMITBRAND ${i + 1} mg, comprimé`,
			substance: "LIMITINE",
			holder: "LAB H",
			marketing_status: MEDICINE_MARKETED,
		})),
	];
	/** ATC code shared by the two OTHERBRAND medicines, both on the MITM list. */
	const otherbrandAtc = "C09AA05";
	/** A listed entry matched to no medicine whose name carries the IOMERONTEST brand. */
	const unmatchedEntry = { id: "1020", name: "Iomerontest 250 et 350 mg, solution injectable" };

	beforeAll(async () => {
		await seed();
		const db = env.DB;
		await db.batch(
			extra.flatMap((m) => [
				db
					.prepare("INSERT INTO medicines (cis, denomination, denomination_norm, form, holder, marketing_status, bdpm_updated_at) VALUES (?, ?, ?, 'comprimé', ?, ?, ?)")
					.bind(m.cis, m.name, normalize(m.name), m.holder, m.marketing_status, BDPM_RELEASE),
				db.prepare("INSERT INTO substances (cis, substance_name, substance_norm, nature) VALUES (?, ?, ?, 'SA')").bind(m.cis, m.substance, normalize(m.substance)),
				db.prepare("INSERT INTO medicines_fts (cis, denomination_norm, substances_norm) VALUES (?, ?, ?)").bind(m.cis, normalize(m.name), normalize(m.substance)),
				db.prepare("INSERT INTO medicines_trgm (cis, denomination_norm, substances_norm) VALUES (?, ?, ?)").bind(m.cis, normalize(m.name), normalize(m.substance)),
				...(m.link
					? [db.prepare("INSERT INTO shortage_matches (shortage_id, cis, method, confidence, is_best) VALUES (?, ?, 'exact', 1, 1)").bind(m.link, m.cis)]
					: []),
			]),
		);
		await db.batch(
			[
				...["60100007", "60100008"].map((cis) => ({ cis, atc: otherbrandAtc })),
				...extra.flatMap((m) => (m.atc ? [{ cis: m.cis, atc: m.atc }] : [])),
			].map(({ cis, atc }) => db.prepare("INSERT INTO mitm (cis, atc_code) VALUES (?, ?)").bind(cis, atc)),
		);
		await db
			.prepare(
				`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, scope, ansm_updated_at, list_hash, first_seen_at, last_seen_at, listed)
				VALUES (?, '/disponibilites-des-produits-de-sante/medicaments/entry-1020', ?, ?, 'tension', 'Tension d''approvisionnement', 'hopital', '2026-10-20', 'h', ?, ?, 1)`,
			)
			.bind(unmatchedEntry.id, unmatchedEntry.name, normalize(unmatchedEntry.name), ANSM_LAST_INGEST, ANSM_LAST_INGEST)
			.run();
	});

	afterAll(seed);

	const resultCis = (data: { results: Array<{ cis: string }> }) => data.results.map((r) => r.cis);

	it("search_medicine ranks a brand prefix of the query before a substance-only match", async () => {
		const ids = resultCis((await call(searchMedicine, { query: "lévothyroxine", limit: 25 })).data);
		expect(ids.indexOf("60100001")).toBeGreaterThanOrEqual(0);
		expect(ids.indexOf("60100001")).toBeLessThan(ids.indexOf("60100002"));
	});

	it("search_medicine ranks an exact brand before a substance-only match among medicines not in shortage", async () => {
		const { data } = await call(searchMedicine, { query: "paracetamol", limit: 25 });
		const ids = resultCis(data);
		expect(ids.indexOf("60100009")).toBeLessThan(ids.indexOf(MEDICINES.dolipraneCapsule.cis));
		expect(data).toMatchObject({ fuzzy: false, did_you_mean: null });
	});

	it("search_medicine returns the closest names and a suggestion for a misspelled name", async () => {
		const { data } = await call(searchMedicine, { query: "doliprame" });
		expect(data).toMatchObject({ fuzzy: true, did_you_mean: normalize("doliprane") });
		expect(resultCis(data)).toEqual(expect.arrayContaining([MEDICINES.dolipraneTablet.cis, MEDICINES.dolipraneCapsule.cis]));
	});

	it("search_medicine keeps the suggestion when only_in_shortage filters every fallback result", async () => {
		const { data } = await call(searchMedicine, { query: "levotyrox", only_in_shortage: true });
		expect(data).toMatchObject({ results: [], fuzzy: true, did_you_mean: normalize("levothyrox") });
	});

	it("get_availability aggregates when no match is in a listed shortage", async () => {
		const { data } = await call(getAvailability, { name: "levothyrox" });
		// The FTS prefix "LEVOTHYROX"* also matches THYROFIX through its substance LEVOTHYROXINE.
		expect(data).toMatchObject({ kind: "aggregated", total: 4, shortage: null, possibly_related_shortages: [] });
		// Rank order: the exact brand first (marketed, shorter name, then CIS), the substance-only match last.
		expect(data.medicines.map((m: { cis: string }) => m.cis)).toEqual(["60100003", "60100004", "60100001", "60100002"]);
	});

	it("get_availability keeps the possibly related entries when no match is linked to a listed entry", async () => {
		const { data, result } = await call(getAvailability, { name: "iomerontest" });
		expect(data).toMatchObject({ kind: "aggregated", total: 2, shortage: null });
		expect(data.possibly_related_shortages.map((s: { shortage_id: string }) => s.shortage_id)).toEqual([unmatchedEntry.id]);
		expect(summary(result)).toContain(unmatchedEntry.name);
	});

	it("resolveName reports a capped match set", async () => {
		expect(await resolveName(env.DB, "testbrand", 1)).toMatchObject({ kind: "candidates", total: 2, capped: true });
	});

	it("get_availability aggregates when every match is in the same listed entry", async () => {
		const { data } = await call(getAvailability, { name: "testbrand" });
		expect(data).toMatchObject({ kind: "aggregated", total: 2, shortage: { shortage_id: SHORTAGES.dolipraneRupture.id }, possibly_related_shortages: [] });
	});

	it("get_availability lists candidates with details when matches are in different entries", async () => {
		const { data } = await call(getAvailability, { name: "otherbrand" });
		expect(data).toMatchObject({ kind: "candidates", total: 2, capped: false });
		expect(data.candidates).toEqual([
			{ cis: "60100007", name: "OTHERBRAND 10 mg, comprimé", holder: "LAB B", marketing_status: MEDICINE_MARKETED, shortage_status: "rupture", is_mitm: true, atc_code: otherbrandAtc },
			{ cis: "60100008", name: "OTHERBRAND 20 mg, comprimé", holder: "LAB C", marketing_status: "Non commercialisée", shortage_status: "tension", is_mitm: true, atc_code: otherbrandAtc },
		]);
	});

	it("get_medicine_info candidates carry the MITM status and ATC code", async () => {
		const { data } = await call(getMedicineInfo, { name: "otherbrand" });
		expect(data.kind).toBe("candidates");
		expect(data.candidates.map((c: { is_mitm: boolean; atc_code: string | null }) => [c.is_mitm, c.atc_code])).toEqual([
			[true, otherbrandAtc],
			[true, otherbrandAtc],
		]);
	});

	it("get_availability suggests a spelling for a misspelled name", async () => {
		expect((await call(getAvailability, { name: "doliprame" })).data).toMatchObject({ kind: "not_found", did_you_mean: normalize("doliprane") });
	});

	it("get_medicine_info lists candidates and never aggregates; both tools suggest a spelling", async () => {
		const suggestion = { kind: "not_found", did_you_mean: normalize("doliprane") };
		expect((await call(getMedicineInfo, { name: "testbrand" })).data).toMatchObject({ kind: "candidates", total: 2, capped: false });
		expect((await call(getMedicineInfo, { name: "doliprame" })).data).toMatchObject(suggestion);
		expect((await call(isMajorTherapeuticInterest, { name: "doliprame" })).data).toMatchObject(suggestion);
	});

	it("is_major_therapeutic_interest answers once when every match shares one ATC code", async () => {
		const { data } = await call(isMajorTherapeuticInterest, { name: "otherbrand" });
		expect(data).toMatchObject({ kind: "aggregated", total: 2, is_mitm: true, atc_code: otherbrandAtc });
		// Rank order: same tier, the marketed OTHERBRAND 10 mg first.
		expect(data.medicines.map((m: { cis: string }) => m.cis)).toEqual(["60100007", "60100008"]);
	});

	it("is_major_therapeutic_interest lists the shared-ATC medicines in rank order, not CIS order, with the mitm answer's source", async () => {
		const { data } = await call(isMajorTherapeuticInterest, { name: "rankbrand" });
		expect(data).toMatchObject({ kind: "aggregated", total: 2, is_mitm: true, atc_code: "N05AH04" });
		expect(data.medicines.map((m: { cis: string }) => m.cis)).toEqual(["60100013", "60100012"]);
		const single = await call(isMajorTherapeuticInterest, { cis: MEDICINES.kardegic.cis });
		expect(data.source).toBe(single.data.source);
	});

	it("is_major_therapeutic_interest returns candidates when MITM matches have different ATC codes", async () => {
		const { data } = await call(isMajorTherapeuticInterest, { name: "splitbrand" });
		expect(data).toMatchObject({ kind: "candidates", total: 2 });
		expect(data.candidates.map((c: { atc_code: string | null }) => c.atc_code).sort()).toEqual(["A10BA02", "A10BB01"]);
	});

	it("is_major_therapeutic_interest keeps at most LINKED_LIMIT medicines in one answer, with the full total", async () => {
		const { data } = await call(isMajorTherapeuticInterest, { name: "limitbrand" });
		expect(data).toMatchObject({ kind: "aggregated", total: LINKED_LIMIT + 1, is_mitm: false });
		expect(data.medicines).toHaveLength(LINKED_LIMIT);
	});

	it("is_major_therapeutic_interest answers once when no match is on the MITM list", async () => {
		expect((await call(isMajorTherapeuticInterest, { name: "testbrand" })).data).toMatchObject({ kind: "aggregated", total: 2, is_mitm: false, atc_code: null });
	});

	it("is_major_therapeutic_interest lists candidates with their MITM status when the matches differ", async () => {
		const { data } = await call(isMajorTherapeuticInterest, { name: "doliprane" });
		expect(data).toMatchObject({ kind: "candidates", total: 2 });
		const byCis = Object.fromEntries(data.candidates.map((c: { cis: string; is_mitm: boolean; atc_code: string | null }) => [c.cis, [c.is_mitm, c.atc_code]]));
		expect(byCis).toEqual({ [MEDICINES.dolipraneTablet.cis]: [true, MEDICINES.dolipraneTablet.atc], [MEDICINES.dolipraneCapsule.cis]: [false, null] });
	});
});
