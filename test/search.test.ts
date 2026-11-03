import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { aggregationGroup, inShortageMatches, MEDICINE_MARKETED, queryTrigrams, rankFuzzy, rankMatches, searchNames } from "../src/lib/db";
import { normalize } from "../src/lib/normalize";
import { MEDICINES, seed } from "./seed";

const row = (cis: string, name: string, marketing_status: string | null = MEDICINE_MARKETED) => ({
	cis,
	denomination_norm: normalize(name),
	marketing_status,
});

describe("rankMatches", () => {
	it("orders exact brand, then brand prefix (both ways), then other matches", () => {
		const rows = [
			row("1", "THYROFIX 100 microgrammes, comprimé"),
			row("2", "LEVOTHYROX 100 microgrammes, comprimé sécable"),
			row("3", "LEVOTHYROXINE BIOGARAN 100 microgrammes, comprimé"),
			row("4", "LEVOTHYROXINESODIQUE 100 microgrammes"),
		];
		const ranked = rankMatches("lévothyroxine", rows);
		expect(ranked.map((m) => [m.cis, m.tier])).toEqual([
			["3", 0],
			["4", 1],
			["2", 1],
			["1", 2],
		]);
	});

	it("does not treat a brand shorter than 5 letters as a prefix of the query", () => {
		expect(rankMatches("abcdef", [row("1", "ABCD 10 mg")])[0]?.tier).toBe(2);
		expect(rankMatches("abcdef", [row("1", "ABCDE 10 mg")])[0]?.tier).toBe(1);
	});

	it("within a tier: marketed first, then shorter name, then CIS", () => {
		const rows = [
			row("9", "DOLIPRANE 1000 mg, comprimé", "Non commercialisée"),
			row("8", "DOLIPRANE 1000 mg, comprimé effervescent"),
			row("7", "DOLIPRANE 500 mg, gélule"),
			row("6", "DOLIPRANE 500 mg, gélule"),
		];
		expect(rankMatches("doliprane", rows).map((m) => m.cis)).toEqual(["6", "7", "8", "9"]);
	});
});

describe("queryTrigrams", () => {
	it("gives the distinct trigrams of each token of 3+ characters", () => {
		expect(queryTrigrams(normalize("doliprame"))).toEqual(["DOL", "OLI", "LIP", "IPR", "PRA", "RAM", "AME"]);
		expect(queryTrigrams(normalize("ab"))).toEqual([]);
		expect(queryTrigrams(normalize("aaaa"))).toEqual(["AAA"]);
	});
});

describe("rankFuzzy", () => {
	const trigrams = queryTrigrams(normalize("doliprame"));
	const fuzzy = (cis: string, name: string, substances: string | null = null) => ({ ...row(cis, name), substances_norm: substances && normalize(substances) });

	it("orders by similarity before the bm25 order it is given, and drops rows below the threshold", () => {
		const rows = [fuzzy("1", "DOLIPRO 10 mg"), fuzzy("2", "DOLIPRANE 1000 mg"), fuzzy("3", "AMOXICILLINE 500 mg")];
		const { matches, did_you_mean } = rankFuzzy(trigrams, rows);
		expect(matches.map((m) => m.cis)).toEqual(["2", "1"]);
		expect(did_you_mean).toBe(normalize("doliprane"));
	});

	it("counts the trigrams found in the substances", () => {
		const { matches, did_you_mean } = rankFuzzy(trigrams, [fuzzy("1", "XYZ 10 mg", "DOLIPRANE")]);
		expect(matches.map((m) => m.cis)).toEqual(["1"]);
		expect(did_you_mean).toBe(normalize("doliprane"));
	});
});

describe("aggregationGroup", () => {
	it("returns the shared entry, null when none is linked, undefined otherwise", () => {
		expect(aggregationGroup(false, ["1001", "1001"])).toBe("1001");
		expect(aggregationGroup(false, [null, null])).toBeNull();
		expect(aggregationGroup(false, ["1001", "1006"])).toBeUndefined();
		expect(aggregationGroup(false, ["1001", null])).toBeUndefined();
		expect(aggregationGroup(true, ["1001", "1001"])).toBeUndefined();
		expect(aggregationGroup(false, [])).toBeUndefined();
	});
});

describe("searchNames", () => {
	beforeAll(seed);

	it("returns every exact match with its total", async () => {
		const search = await searchNames(env.DB, "doliprane");
		expect(search).toMatchObject({ total: 2, capped: false, fuzzy: false, did_you_mean: null });
		expect(search.matches.map((m) => m.cis).sort()).toEqual([MEDICINES.dolipraneTablet.cis, MEDICINES.dolipraneCapsule.cis].sort());
	});

	it("falls back to the trigram index for a misspelled name, with the closest token", async () => {
		const search = await searchNames(env.DB, "doliprame");
		expect(search).toMatchObject({ fuzzy: true, did_you_mean: normalize("doliprane") });
		expect(search.matches.map((m) => m.cis)).toEqual(expect.arrayContaining([MEDICINES.dolipraneTablet.cis, MEDICINES.dolipraneCapsule.cis]));
		expect(search.total).toBe(search.matches.length);
	});

	it("counts every match, and beyond the cap keeps every match in rupture or tension", async () => {
		const search = await searchNames(env.DB, "doliprane", 1);
		expect(search).toMatchObject({ total: 2, capped: true, fuzzy: false });
		expect(search.matches.map((m) => m.cis)).toContain(MEDICINES.dolipraneTablet.cis);
		expect((await inShortageMatches(env.DB, '"DOLIPRANE"*')).map((r) => r.cis)).toEqual([MEDICINES.dolipraneTablet.cis]);
	});

	it("finds nothing for a query far from every name", async () => {
		expect(await searchNames(env.DB, "zzzunknown")).toEqual({ matches: [], total: 0, capped: false, fuzzy: false, did_you_mean: null });
	});
});
