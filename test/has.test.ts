import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { buildHasSql, HAS_CT_LINKS_CREATE, HAS_FILES, HAS_OPINIONS_CREATE, HAS_OPINIONS_INDEX, type HasInput, mapHas } from "../scripts/bdpm/has";
import { parseTsv } from "../src/lib/tsv";
import { count } from "./db";

const cis = (i: number): string => String(61_000_000 + i);
const KNOWN = new Set(Array.from({ length: 100 }, (_, i) => cis(i)));
/** A CIS absent from `KNOWN`. */
const UNKNOWN = "69999999";

const opinionRow = (c: string, dossier: string, date: string, value: string, motif = "Inscription (CT)", label = "Le service médical rendu est important."): string[] => [
	c,
	dossier,
	motif,
	date,
	value,
	label,
];
const linkRow = (dossier: string, page: string): string[] => [dossier, `https://www.has-sante.fr/jcms/${page}`];

/** Rows `head` followed by filler rows of unknown CIS up to `floor`, so the file passes its floor. */
const filled = (head: string[][], floor: number, filler: (i: number) => string[]): string[][] => [
	...head,
	...Array.from({ length: Math.max(0, floor - head.length) }, (_, i) => filler(i)),
];

function input(over: Partial<{ smr: string[][]; asmr: string[][]; ctLinks: string[][] }> = {}): HasInput {
	return {
		smr: filled(over.smr ?? [], HAS_FILES.smr.floor, (i) => opinionRow(UNKNOWN, `CT-${90_000 + i}`, "20200101", "Important")),
		asmr: filled(over.asmr ?? [], HAS_FILES.asmr.floor, (i) => opinionRow(UNKNOWN, `CT-${90_000 + i}`, "20200101", "V")),
		ctLinks: filled(over.ctLinks ?? [], HAS_FILES.ctLinks.floor, (i) => linkRow(`CT-${80_000 + i}`, `p_${i}`)),
	};
}

/** The migration's statements, without comment lines or trailing semicolon. */
function migrationStatements(): string[] {
	const migration = env.TEST_MIGRATIONS.find((m) => m.name === "0014_has_opinions.sql");
	if (migration === undefined) throw new Error("migration 0014_has_opinions.sql not loaded");
	return migration.queries.map((q) =>
		q
			.split("\n")
			.filter((line) => !line.trimStart().startsWith("--"))
			.join("\n")
			.trim()
			.replace(/;$/, ""),
	);
}

describe("HAS opinions mapping", () => {
	it("maps valid rows with ISO dates, kinds and per-kind positions, the label dropped", () => {
		const out = mapHas(
			input({
				smr: [opinionRow(cis(1), "CT-21501", "20250827", "Insuffisant"), opinionRow(cis(1), "CT-21501", "20250827", "Modéré"), opinionRow(cis(2), "CT-100", "20021218", "Important")],
				asmr: [opinionRow(cis(1), "CT-21501", "20250827", "V")],
			}),
			KNOWN,
		);
		expect(out.opinions).toEqual([
			{ cis: cis(1), kind: "smr", dossier: "CT-21501", motif: "Inscription (CT)", opinion_date: "2025-08-27", value: "Insuffisant", position: 1 },
			{ cis: cis(1), kind: "smr", dossier: "CT-21501", motif: "Inscription (CT)", opinion_date: "2025-08-27", value: "Modéré", position: 2 },
			{ cis: cis(2), kind: "smr", dossier: "CT-100", motif: "Inscription (CT)", opinion_date: "2002-12-18", value: "Important", position: 3 },
			{ cis: cis(1), kind: "asmr", dossier: "CT-21501", motif: "Inscription (CT)", opinion_date: "2025-08-27", value: "V", position: 1 },
		]);
	});

	it("skips and counts rows of unknown CIS", () => {
		const out = mapHas(input({ smr: [opinionRow(cis(1), "CT-1", "20250101", "Important")] }), KNOWN);
		expect(out.opinions).toHaveLength(1);
		expect(out.skipped).toEqual({ smr: HAS_FILES.smr.floor - 1, asmr: HAS_FILES.asmr.floor });
	});

	it("collapses rows differing only by label, keeping the first position", () => {
		const out = mapHas(
			input({
				asmr: [
					opinionRow(cis(1), "CT-1", "20250101", "IV", "Inscription (CT)", "ASMR mineure"),
					opinionRow(cis(1), "CT-1", "20250101", "IV", "Inscription (CT)", "ASMR mineure dans la prise en charge"),
					opinionRow(cis(1), "CT-1", "20250101", "V", "Inscription (CT)", "ASMR mineure"),
				],
			}),
			KNOWN,
		);
		expect(out.opinions.map((o) => [o.value, o.position])).toEqual([
			["IV", 1],
			["V", 2],
		]);
	});

	it("rejects a file below its floor, with the file name", () => {
		const short = input();
		expect(() => mapHas({ ...short, smr: short.smr.slice(1) }, KNOWN)).toThrow("CIS_HAS_SMR_bdpm.txt: 11999 rows, below the floor of 12000");
		expect(() => mapHas({ ...short, asmr: short.asmr.slice(1) }, KNOWN)).toThrow("CIS_HAS_ASMR_bdpm.txt: 7499 rows, below the floor of 7500");
		expect(() => mapHas({ ...short, ctLinks: short.ctLinks.slice(1) }, KNOWN)).toThrow("HAS_LiensPageCT_bdpm.txt: 7999 rows, below the floor of 8000");
	});

	it("rejects an invalid CIS, dossier, date, empty motif or value, with file and line", () => {
		const bad = (row: string[], kind: "smr" | "asmr" = "smr") => () => mapHas(input({ [kind]: [opinionRow(cis(1), "CT-1", "20250101", "V"), row] }), KNOWN);
		expect(bad(opinionRow("6100000", "CT-1", "20250101", "V"))).toThrow('CIS_HAS_SMR_bdpm.txt: line 2 has invalid CIS "6100000", expected 8 digits');
		expect(bad(opinionRow(cis(1), "CT1", "20250101", "V"), "asmr")).toThrow('CIS_HAS_ASMR_bdpm.txt: line 2 has invalid dossier "CT1"');
		expect(bad(opinionRow(cis(1), "CT-1", "20250231", "V"))).toThrow('CIS_HAS_SMR_bdpm.txt: line 2 has invalid date "20250231", expected YYYYMMDD');
		expect(bad(opinionRow(cis(1), "CT-1", "2025-01-01", "V"))).toThrow('CIS_HAS_SMR_bdpm.txt: line 2 has invalid date "2025-01-01"');
		expect(bad(opinionRow(cis(1), "CT-1", "20250101", "V", ""))).toThrow("CIS_HAS_SMR_bdpm.txt: line 2 has an empty motif");
		expect(bad(opinionRow(cis(1), "CT-1", "20250101", ""), "asmr")).toThrow("CIS_HAS_ASMR_bdpm.txt: line 2 has an empty value");
		// Rows of unknown CIS are validated too.
		expect(bad(opinionRow(UNKNOWN, "CT-1", "20251301", "V"))).toThrow('CIS_HAS_SMR_bdpm.txt: line 2 has invalid date "20251301"');
	});

	it("rejects a links row with an invalid dossier or a non-HAS URL", () => {
		const bad = (row: string[]) => () => mapHas(input({ ctLinks: [linkRow("CT-1", "p_1"), row] }), KNOWN);
		expect(bad(["CT-x", "https://www.has-sante.fr/jcms/p_1"])).toThrow('HAS_LiensPageCT_bdpm.txt: line 2 has invalid dossier "CT-x"');
		for (const url of ["http://www.has-sante.fr/jcms/p_1", "https://has-sante.fr/jcms/p_1", "https://www.has-sante.fr.evil.com/x", ""]) {
			expect(bad(["CT-2", url])).toThrow(`HAS_LiensPageCT_bdpm.txt: line 2 has a non-HAS URL "${url}"`);
		}
	});

	it("rejects a line with the wrong column count when parsed", () => {
		expect(() => parseTsv(`${cis(1)}\tCT-1\tInscription (CT)\t20250101\tV\n`, HAS_FILES.smr.cols, HAS_FILES.smr.name)).toThrow(
			"CIS_HAS_SMR_bdpm.txt: line 1 has 5 columns, expected 6",
		);
		expect(() => parseTsv("CT-1\n", HAS_FILES.ctLinks.cols, HAS_FILES.ctLinks.name)).toThrow("HAS_LiensPageCT_bdpm.txt: line 1 has 1 columns, expected 2");
	});

	it("stores the page of referenced single-page dossiers only, and counts multi-page dossiers", () => {
		const out = mapHas(
			input({
				smr: [opinionRow(cis(1), "CT-1", "20250101", "Important"), opinionRow(cis(2), "CT-2", "20250101", "Faible")],
				asmr: [opinionRow(cis(3), "CT-3", "20250101", "V")],
				ctLinks: [
					linkRow("CT-1", "p_1"),
					linkRow("CT-1", "p_1"),
					linkRow("CT-2", "p_2a"),
					linkRow("CT-2", "c_2b"),
					linkRow("CT-3", "c_3"),
					linkRow("CT-4", "p_4a"),
					linkRow("CT-4", "p_4b"),
				],
			}),
			KNOWN,
		);
		expect(out.ct_links).toEqual([
			{ dossier: "CT-1", url: "https://www.has-sante.fr/jcms/p_1" },
			{ dossier: "CT-3", url: "https://www.has-sante.fr/jcms/c_3" },
		]);
		expect(out.multiPageDossiers).toBe(2);
	});
});

describe("HAS statements in the import", () => {
	it("are the migration's create statements, followed by deletes and inserts", () => {
		const statements = migrationStatements();
		for (const s of [HAS_OPINIONS_CREATE, HAS_OPINIONS_INDEX, HAS_CT_LINKS_CREATE]) expect(statements).toContain(s);
		const sql = buildHasSql(mapHas(input({ smr: [opinionRow(cis(1), "CT-1", "20250101", "Important")], ctLinks: [linkRow("CT-1", "p_1")] }), KNOWN));
		expect(sql.slice(0, 5)).toEqual([`${HAS_OPINIONS_CREATE};`, `${HAS_OPINIONS_INDEX};`, `${HAS_CT_LINKS_CREATE};`, "DELETE FROM has_opinions;", "DELETE FROM has_ct_links;"]);
		expect(sql.slice(5)).toEqual([
			"INSERT INTO has_opinions (cis, kind, dossier, motif, opinion_date, value, position) VALUES ('61000001','smr','CT-1','Inscription (CT)','2025-01-01','Important',1);",
			"INSERT INTO has_ct_links (dossier, url) VALUES ('CT-1','https://www.has-sante.fr/jcms/p_1');",
		]);
	});

	it("never carries the label, which can name another medicine", () => {
		const label = "ASMR mineure (V) par rapport à OTHERBRAND 10 mg";
		const sql = buildHasSql(mapHas(input({ asmr: [opinionRow(cis(1), "CT-1", "20250101", "V", "Inscription (CT)", label)] }), KNOWN)).join("\n");
		expect(sql).toContain("'61000001','asmr','CT-1'");
		expect(sql).not.toContain("OTHERBRAND");
		expect(sql).not.toContain("par rapport");
	});

	it("recreates and fills the tables when the migration has not run, and the migration then runs", async () => {
		const sql = buildHasSql(
			mapHas(input({ smr: [opinionRow(cis(1), "CT-1", "20250101", "Important"), opinionRow(cis(2), "CT-2", "20250101", "Faible")], ctLinks: [linkRow("CT-1", "p_1")] }), KNOWN),
		);
		await env.DB.batch([env.DB.prepare("DROP TABLE IF EXISTS has_opinions"), env.DB.prepare("DROP TABLE IF EXISTS has_ct_links")]);
		expect(await count("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('has_opinions', 'has_ct_links', 'idx_has_opinions_cis')")).toBe(0);
		await env.DB.batch(sql.map((s) => env.DB.prepare(s)));
		expect(await count("SELECT COUNT(*) AS n FROM has_opinions")).toBe(2);
		expect(await count("SELECT COUNT(*) AS n FROM has_ct_links")).toBe(1);
		expect(await count("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'idx_has_opinions_cis'")).toBe(1);
		await env.DB.batch(migrationStatements().map((s) => env.DB.prepare(s)));
		expect(await count("SELECT COUNT(*) AS n FROM has_opinions")).toBe(2);
		await env.DB.batch([env.DB.prepare("DELETE FROM has_opinions"), env.DB.prepare("DELETE FROM has_ct_links")]);
	});
});
