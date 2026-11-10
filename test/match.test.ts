import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseList } from "../src/ingest/ansm";
import { parseDispo } from "../src/ingest/dispo";
import {
	afterIngest,
	buildMatchInputs,
	doseVariants,
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
import { fakeFetcher, fixtureBytes, LIST_HTML, stubExtract } from "./fixtures";

const shortage = (id: string, name: string, path = `/p/${id}`): ListedShortage => ({
	id,
	ansm_path: path,
	raw_name: name,
	raw_name_norm: normalize(name),
});
const med = (cis: string, name: string, form: string | null = null, holder: string | null = null): Medicine => ({
	cis,
	denomination_norm: normalize(name),
	form,
	holder,
});

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

describe("regressions", () => {
	const byCis = <T extends { cis: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.cis.localeCompare(b.cis));

	it("dose list: AMIKACINE VIATRIS 250 MG 500 MG ET 1 G links each dose, not the 50 MG/1 ML solution", () => {
		const powder = "poudre pour solution injectable";
		const meds = [
			med("62048906", "AMIKACINE VIATRIS 250 MG POUDRE POUR SOLUTION INJECTABLE", powder, "VIATRIS SANTE"),
			med("68502148", "AMIKACINE VIATRIS 500 MG POUDRE POUR SOLUTION INJECTABLE", powder, "VIATRIS SANTE"),
			med("62516778", "AMIKACINE VIATRIS 1 G POUDRE POUR SOLUTION INJECTABLE EN FLACON", powder, "VIATRIS SANTE"),
			med("62000612", "AMIKACINE VIATRIS 50 MG/1 ML SOLUTION INJECTABLE", "solution injectable", "VIATRIS SANTE"),
		];
		const s = shortage("1035", "AMIKACINE VIATRIS 250 MG 500 MG ET 1 G POUDRE POUR SOLUTION INJECTABLE EN FLACON");
		const rows = matchShortage(buildMatchInputs([s], [], meds, {}), s);
		expect(byCis(rows).map((r) => [r.cis, r.method])).toEqual([
			["62048906", "exact"],
			["62516778", "exact"],
			["68502148", "exact"],
		]);
	});

	it("sibling: the LP 50 MG of a holder already linked to a dispo entry is linked", () => {
		const lp = "comprimé à libération prolongée";
		const meds = [
			med("60000150", "QUETIAPINE ACCORD HEALTHCARE LP 50 MG COMPRIME A LIBERATION PROLONGEE", lp, "ACCORD HEALTHCARE FRANCE"),
			med("66086110", "QUETIAPINE ARROW LP 300 MG COMPRIME A LIBERATION PROLONGEE", lp, "ARROW GENERIQUES"),
			med("64633851", "QUETIAPINE ARROW LP 400 MG COMPRIME A LIBERATION PROLONGEE", lp, "ARROW GENERIQUES"),
			med("61334872", "QUETIAPINE ARROW LP 50 MG COMPRIME A LIBERATION PROLONGEE", lp, "ARROW GENERIQUES"),
		];
		const s = shortage("1128", "QUETIAPINE LP 50 MG 300 MG ET 400 MG COMPRIMES A LIBERATION PROLONGEE");
		const dispo = ["60000150", "66086110", "64633851"].map((cis) => ({ ansm_path: s.ansm_path, cis }));
		const rows = matchShortage(buildMatchInputs([s], dispo, meds, {}), s);
		expect(rows.find((r) => r.cis === "61334872")).toEqual({ shortage_id: "1128", cis: "61334872", method: "sibling", confidence: 1, is_best: 1 });
		expect(rows).toHaveLength(4);
	});
});

describe("doseVariants", () => {
	it("expands the first dose list, one name per dose in list order", () => {
		expect(doseVariants("AMIKACINE VIATRIS 250 MG 500 MG ET 1 G POUDRE POUR SOLUTION INJECTABLE EN FLACON")).toEqual([
			"AMIKACINE VIATRIS 250 MG POUDRE POUR SOLUTION INJECTABLE EN FLACON",
			"AMIKACINE VIATRIS 500 MG POUDRE POUR SOLUTION INJECTABLE EN FLACON",
			"AMIKACINE VIATRIS 1 G POUDRE POUR SOLUTION INJECTABLE EN FLACON",
		]);
	});

	it("needs ET before the last dose, unit-delimited doses and a unit on every dose", () => {
		expect(doseVariants("COLI GENTA AP HP 135 MG 100 MG GELULE ADULTE")).toEqual([]);
		expect(doseVariants("IOMERON 250 350 ET 400 MG IODE/ML SOLUTION INJECTABLE EN 50 100 200 ET 500 ML")).toEqual([]);
		expect(doseVariants("X 250 MG ET 500 MG/5 ML")).toEqual([]);
	});
});

describe("sibling pass", () => {
	const lp = "comprimé à libération prolongée";
	const s = shortage("20", "QUETIAPINE LP 50 MG ET 300 MG COMPRIMES A LIBERATION PROLONGEE");
	const linked = [
		med("1", "QUETIAPINE ACCORD LP 50 MG COMPRIME A LIBERATION PROLONGEE", lp),
		med("2", "QUETIAPINE ARROW LP 300 MG COMPRIME A LIBERATION PROLONGEE", lp),
	];
	const dispo = linked.map((m) => ({ ansm_path: s.ansm_path, cis: m.cis }));
	const siblings = (extra: Medicine[], manual: Record<string, string[]> = {}) =>
		matchShortage(buildMatchInputs([s], dispo, [...linked, ...extra], manual), s).filter((r) => r.method === "sibling");

	it("skips a name that differs by more than its numbers", () => {
		expect(siblings([med("3", "QUETIAPINE BIOGARAN LP 50 MG COMPRIME A LIBERATION PROLONGEE", lp)])).toEqual([]);
		expect(siblings([med("3", "QUETIAPINE ARROW LAB LP 50 MG COMPRIME A LIBERATION PROLONGEE", lp)])).toEqual([]);
	});

	it("skips a dose absent from the linked medicines", () => {
		expect(siblings([med("3", "QUETIAPINE ARROW LP 400 MG COMPRIME A LIBERATION PROLONGEE", lp)])).toEqual([]);
	});

	it("skips another form and a medicine without form", () => {
		expect(siblings([med("3", "QUETIAPINE ARROW LP 50 MG COMPRIME A LIBERATION PROLONGEE", "comprimé pelliculé")])).toEqual([]);
		expect(siblings([med("4", "QUETIAPINE ARROW LP 50 MG COMPRIME A LIBERATION PROLONGEE")])).toEqual([]);
	});

	it("adds no sibling to a manual entry", () => {
		const arrow50 = med("3", "QUETIAPINE ARROW LP 50 MG COMPRIME A LIBERATION PROLONGEE", lp);
		expect(siblings([arrow50])).toHaveLength(1);
		expect(siblings([arrow50], { "20": ["1", "2"] })).toEqual([]);
	});

	it("does not link another device of the same product (PUMPCART entry, FLEXPEN medicine)", () => {
		const sol = "solution injectable";
		const pumpcart = med("1", "NOVORAPID PUMPCART 100 UNITES/ML SOLUTION INJECTABLE EN CARTOUCHE", sol);
		const flexpen = med("2", "NOVORAPID FLEXPEN 100 UNITES/ML SOLUTION INJECTABLE EN STYLO PREREMPLI", sol);
		const e = shortage("30", "NOVORAPID PUMPCART 100 UNITES/ML SOLUTION INJECTABLE EN CARTOUCHE");
		const rows = matchShortage(buildMatchInputs([e], [{ ansm_path: e.ansm_path, cis: "1" }], [pumpcart, flexpen], {}), e);
		expect(rows.map((r) => r.cis)).toEqual(["1"]);
	});
});

describe("fuzzy and dose lists", () => {
	it("does not fuzzy-match a dose-list variant to another product (ALYOSTAL POLISTES vs VESPULA)", () => {
		const s = shortage("125", "ALYOSTAL VENIN DE GUEPE POLISTES 110 MCG ET 550 MCG POUDRE ET SOLVANT POUR SOLUTION INJECTABLE");
		const vespula = med("1", "ALYOSTAL VENIN DE GUEPE VESPULA 110 MCG POUDRE ET SOLVANT POUR SOLUTION INJECTABLE", "poudre et solvant pour solution injectable");
		expect(matchShortage(buildMatchInputs([s], [], [vespula], {}), s)).toEqual([]);
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

	it("replaces all rows in one batch and logs unmatched entries", async () => {
		await seed();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const counted = queryCount();
		expect(await matchAll(env)).toEqual({ manual: 0, dispo: 1, exact: 1, fuzzy: 0, sibling: 0, none: 1 });
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
		expect(counted.batches()).toBe(1);
		expect(await matches()).toHaveLength(45);
	});

	it("the hook returns the per-method fragment", async () => {
		await seed();
		vi.spyOn(console, "log").mockImplementation(() => {});
		const { sibling } = await matchAll(env);
		const fragment = await afterIngest(env, { id: 1, bootstrap: false });
		expect(fragment.startsWith("match: ")).toBe(true);
		for (const part of ["manual=0", "dispo=1", "exact=1", "fuzzy=0", `sibling=${sibling}`]) expect(fragment.split(" ")).toContain(part);
	});

	it("a full ingest appends the match fragment to the run message", { timeout: 30_000 }, async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const rows = await parseList(LIST_HTML);
		const listed = new Set(rows.map((r) => r.ansm_path));
		const row = parseDispo(fixtureBytes("bdpm/CIS_CIP_Dispo_Spec.txt"), 10).find((r) => listed.has(r.ansm_path));
		if (!row) throw new Error("no dispo row on a listed path");
		await seedMedicine({ cis: row.cis, name: "SEEDED MEDICINE" }).run();
		const res = ran(await runIngest(env, fakeFetcher(), { dispoMinRows: 10, detailIntervalMs: 0, extract: stubExtract() }));
		expect(res.status).toBe("ok");
		const fragment = res.message.split("; ").find((p) => p.startsWith("match: "));
		expect(fragment?.split(" ")).toEqual(expect.arrayContaining(["dispo=1", `none=${rows.length - 1}`]));
		expect(fragment).toMatch(/ sibling=\d+(\s|$)/);
	});
});
