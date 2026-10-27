import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseList } from "../src/ingest/ansm";
import { parseDispo } from "../src/ingest/dispo";
import { afterIngest } from "../src/ingest/hooks";
import {
	buildMatchInputs,
	type ListedShortage,
	type Medicine,
	matchAll,
	matchDispo,
	matchExact,
	matchFuzzy,
	matchManual,
	matchShortage,
} from "../src/ingest/match";
import { runIngest } from "../src/ingest/run";
import { normalize } from "../src/lib/normalize";
import { queryCount, ran, resetDb } from "./db";
import { fakeFetcher, fixtureBytes, LIST_HTML } from "./fixtures";

const shortage = (id: string, name: string, path = `/p/${id}`): ListedShortage => ({
	id,
	ansm_path: path,
	raw_name: name,
	raw_name_norm: normalize(name),
});
const med = (cis: string, name: string): Medicine => ({ cis, denomination_norm: normalize(name) });

describe("strategies", () => {
	it("manual: overrides at confidence 1, unknown CIS dropped", () => {
		const inputs = buildMatchInputs([], [], [med("1", "A"), med("2", "B")], { "10": ["1", "2", "2", "9"] });
		expect(matchManual(inputs, shortage("10", "X"))).toEqual([
			{ cis: "1", confidence: 1 },
			{ cis: "2", confidence: 1 },
		]);
		expect(matchManual(inputs, shortage("11", "X"))).toEqual([]);
	});

	it("dispo: distinct CIS of the path, a CIS absent from medicines is dropped", () => {
		const dispo = [
			{ ansm_path: "/p/10", cis: "1" },
			{ ansm_path: "/p/10", cis: "1" },
			{ ansm_path: "/p/10", cis: "2" },
			{ ansm_path: "/p/10", cis: "99" },
			{ ansm_path: "/p/other", cis: "3" },
		];
		const inputs = buildMatchInputs([], dispo, [med("1", "A"), med("2", "B"), med("3", "C")], {});
		expect(matchDispo(inputs, shortage("10", "X"))).toEqual([
			{ cis: "1", confidence: 1 },
			{ cis: "2", confidence: 1 },
		]);
		const onlyUnknown = buildMatchInputs([], [{ ansm_path: "/p/10", cis: "99" }], [med("1", "A")], {});
		expect(matchDispo(onlyUnknown, shortage("10", "X"))).toEqual([]);
	});

	it("exact: equality and both prefix directions at 0.95", () => {
		const inputs = buildMatchInputs(
			[],
			[],
			[
				med("1", "DOLIPRANE 1000 mg, comprimé"),
				med("2", "DOLIPRANE 1000 mg"),
				med("3", "DOLIPRANE 1000 mg, comprimé effervescent"),
				med("4", "DOLIPRANE 500 mg, comprimé"),
				med("5", "DOLIPRANE 1000 mg, comprimés"),
			],
			{},
		);
		expect(matchExact(inputs, shortage("10", "DOLIPRANE 1000 mg, comprimé"))).toEqual([
			{ cis: "1", confidence: 0.95 },
			{ cis: "2", confidence: 0.95 },
			{ cis: "3", confidence: 0.95 },
		]);
	});

	it("fuzzy: same brand, same doses, Jaccard >= 0.8, confidence rounded", () => {
		const inputs = buildMatchInputs(
			[],
			[],
			[med("1", "DOLIPRANE comprimé 1000 mg"), med("2", "DOLIPRANE comprimé sécable 1000 mg"), med("3", "EFFERALGAN comprimé 1000 mg")],
			{},
		);
		expect(matchFuzzy(inputs, shortage("10", "DOLIPRANE 1000 mg, comprimé"))).toEqual([
			{ cis: "1", confidence: 1 },
			{ cis: "2", confidence: 0.8 },
		]);
	});

	it("fuzzy rejects WINREVAIR 60 MG vs WINREVAIR 45 MG", () => {
		const inputs = buildMatchInputs([], [], [med("1", "WINREVAIR 45 mg, poudre et solvant pour solution injectable")], {});
		const s = shortage("10", "WINREVAIR 60 mg, poudre et solvant pour solution injectable");
		expect(matchFuzzy(inputs, s)).toEqual([]);
		expect(matchShortage(inputs, s)).toEqual([]);
	});

	it("fuzzy rejects a score below 0.8 and keeps 5/6 at 0.83", () => {
		const s = shortage("10", "ALPHA BETA GAMMA DELTA EPSILON");
		const low = buildMatchInputs([], [], [med("1", "ALPHA GAMMA BETA DELTA ZETA ETA")], {});
		expect(matchFuzzy(low, s)).toEqual([]);
		const high = buildMatchInputs([], [], [med("1", "ALPHA GAMMA BETA DELTA EPSILON ZETA")], {});
		expect(matchFuzzy(high, s)).toEqual([{ cis: "1", confidence: 0.83 }]);
	});

	it("fuzzy skips SPECIALITES, short and numeric brands", () => {
		const meds = [
			med("1", "SPÉCIALITÉS TAZOBACTAM PIPÉRACILLINE à base de"),
			med("2", "AB TAZOBACTAM PIPERACILLINE"),
			med("3", "12 TAZOBACTAM PIPERACILLINE"),
			med("4", "TAZOCILLINE TAZOBACTAM PIPERACILLINE"),
		];
		const inputs = buildMatchInputs([], [], meds, {});
		expect(matchFuzzy(inputs, shortage("10", "Spécialités à base de pipéracilline tazobactam"))).toEqual([]);
		expect(matchFuzzy(inputs, shortage("11", "AB PIPERACILLINE TAZOBACTAM"))).toEqual([]);
		expect(matchFuzzy(inputs, shortage("12", "12 PIPERACILLINE TAZOBACTAM"))).toEqual([]);
		expect(matchFuzzy(inputs, shortage("13", "TAZOCILLINE PIPERACILLINE TAZOBACTAM"))).toEqual([{ cis: "4", confidence: 1 }]);
	});
});

describe("matchShortage", () => {
	const s = shortage("10", "DOLIPRANE 1000 mg, comprimé");
	const meds = [med("1", "DOLIPRANE 1000 mg, comprimé"), med("2", "DOLIPRANE comprimé 1000 mg"), med("3", "OTHER")];

	it("manual beats dispo, dispo beats exact, exact beats fuzzy", () => {
		const dispo = [{ ansm_path: s.ansm_path, cis: "3" }];
		expect(matchShortage(buildMatchInputs([], dispo, meds, { "10": ["2"] }), s)).toEqual([
			{ shortage_id: "10", cis: "2", method: "manual", confidence: 1, is_best: 1 },
		]);
		expect(matchShortage(buildMatchInputs([], dispo, meds, {}), s)).toEqual([
			{ shortage_id: "10", cis: "3", method: "dispo", confidence: 1, is_best: 1 },
		]);
		expect(matchShortage(buildMatchInputs([], [], meds, {}), s)).toEqual([
			{ shortage_id: "10", cis: "1", method: "exact", confidence: 0.95, is_best: 1 },
		]);
		expect(matchShortage(buildMatchInputs([], [], meds.slice(1), {}), s)).toEqual([
			{ shortage_id: "10", cis: "2", method: "fuzzy", confidence: 1, is_best: 1 },
		]);
	});

	it("an override whose CIS are all unknown falls through to the next strategy", () => {
		expect(matchShortage(buildMatchInputs([], [], meds, { "10": ["99"] }), s)[0]?.method).toBe("exact");
	});

	it("sets is_best on every max-confidence row", () => {
		const inputs = buildMatchInputs(
			[],
			[],
			[med("1", "DOLIPRANE comprimé 1000 mg"), med("2", "DOLIPRANE mg 1000 comprimé"), med("3", "DOLIPRANE comprimé pelliculé 1000 mg")],
			{},
		);
		expect(matchShortage(inputs, s)).toEqual([
			{ shortage_id: "10", cis: "1", method: "fuzzy", confidence: 1, is_best: 1 },
			{ shortage_id: "10", cis: "2", method: "fuzzy", confidence: 1, is_best: 1 },
			{ shortage_id: "10", cis: "3", method: "fuzzy", confidence: 0.8, is_best: 0 },
		]);
	});
});

function seedShortage(s: ListedShortage, listed = 1): D1PreparedStatement {
	return env.DB.prepare(
		"INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, list_hash, first_seen_at, last_seen_at, listed) VALUES (?, ?, ?, ?, 'rupture', 'Rupture de stock', 'h', 't', 't', ?)",
	).bind(s.id, s.ansm_path, s.raw_name, s.raw_name_norm, listed);
}

const seedMedicine = (m: { cis: string; name: string }): D1PreparedStatement =>
	env.DB.prepare("INSERT INTO medicines (cis, denomination, denomination_norm, bdpm_updated_at) VALUES (?, ?, ?, '2026-10-01')").bind(
		m.cis,
		m.name,
		normalize(m.name),
	);

const matches = () =>
	env.DB.prepare("SELECT shortage_id, cis, method, confidence, is_best FROM shortage_matches ORDER BY shortage_id, cis")
		.all()
		.then((r) => r.results);

describe("matchAll", () => {
	beforeEach(async () => {
		await resetDb();
		vi.restoreAllMocks();
	});

	async function seed(): Promise<void> {
		await env.DB.batch([
			seedShortage(shortage("1", "DOLIPRANE 1000 mg, comprimé")),
			seedShortage(shortage("2", "SECTRAL LP 500 mg", "/p/sectral")),
			seedShortage(shortage("3", "INCONNU 5 mg")),
			seedShortage(shortage("4", "DOLIPRANE 1000 mg, comprimé"), 0),
			seedMedicine({ cis: "100", name: "DOLIPRANE 1000 mg, comprimé" }),
			seedMedicine({ cis: "200", name: "SECTRAL LP 500 mg, comprimé" }),
			env.DB.prepare("INSERT INTO bdpm_dispo (cis, status_code, status_label, ansm_path) VALUES ('200', 1, 'Rupture', '/p/sectral'), ('999', 1, 'Rupture', '/p/sectral')"),
			env.DB.prepare("INSERT INTO shortage_matches (shortage_id, cis, method, confidence, is_best) VALUES ('old', 'x', 'exact', 0.95, 1)"),
		]);
	}

	it("replaces all rows in one batch with exactly 4 queries and logs unmatched entries", async () => {
		await seed();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const counted = queryCount();
		expect(await matchAll(env)).toEqual({ manual: 0, dispo: 1, exact: 1, fuzzy: 0, none: 1 });
		expect(counted.queries()).toBe(4);
		expect(counted.batches()).toBe(1);
		expect(await matches()).toEqual([
			{ shortage_id: "1", cis: "100", method: "exact", confidence: 0.95, is_best: 1 },
			{ shortage_id: "2", cis: "200", method: "dispo", confidence: 1, is_best: 1 },
		]);
		expect(log.mock.calls.map((c) => c[0])).toEqual([JSON.stringify({ event: "unmatched", id: "3", raw_name: "INCONNU 5 mg" })]);
	});

	it("writes more than 20 rows across several INSERTs", async () => {
		await env.DB.batch([
			seedShortage(shortage("1", "X", "/p/many")),
			...Array.from({ length: 45 }, (_, i) => seedMedicine({ cis: String(1000 + i), name: `M ${i}` })),
		]);
		const dispo = Array.from({ length: 45 }, (_, i) =>
			env.DB.prepare("INSERT INTO bdpm_dispo (cis, status_code, status_label, ansm_path) VALUES (?, 1, 'Rupture', '/p/many')").bind(String(1000 + i)),
		);
		await env.DB.batch(dispo);
		const counted = queryCount();
		await matchAll(env);
		expect(counted.queries()).toBe(4);
		expect(await matches()).toHaveLength(45);
	});

	it("the hook returns the per-method fragment", async () => {
		await seed();
		vi.spyOn(console, "log").mockImplementation(() => {});
		expect(await afterIngest(env, { id: 1, bootstrap: false })).toBe("match: manual=0 dispo=1 exact=1 fuzzy=0 none=1");
	});

	it("a full ingest appends the match fragment to the run message", { timeout: 30_000 }, async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const rows = await parseList(LIST_HTML);
		const listed = new Set(rows.map((r) => r.ansm_path));
		const row = parseDispo(fixtureBytes("bdpm/CIS_CIP_Dispo_Spec.txt"), 10).find((r) => listed.has(r.ansm_path));
		if (!row) throw new Error("no dispo row on a listed path");
		await seedMedicine({ cis: row.cis, name: "SEEDED MEDICINE" }).run();
		const res = ran(await runIngest(env, fakeFetcher(), { dispoMinRows: 10, detailIntervalMs: 0 }));
		expect(res.status).toBe("ok");
		expect(res.message).toBe(`bootstrap; dispo=ok; match: manual=0 dispo=1 exact=0 fuzzy=0 none=${rows.length - 1}`);
	});
});
