import { describe, expect, it } from "vitest";
import { validateAndMap, type BdpmInput } from "../scripts/bdpm/map";
import { decodeCp1252, parseBanner, parseTsv } from "../scripts/bdpm/parse";
import { buildImportSql, insertStatements, sqlLiteral } from "../scripts/bdpm/sql";
import { parseTsv as sharedParseTsv } from "../src/lib/tsv";

const cis = (i: number): string => String(60_000_000 + i);

function medicineRow(i: number, denomination = `MEDICAMENT ${i} 10 mg, comprimé`): string[] {
	return [cis(i), denomination, "comprimé", "orale", "Autorisation active", "Procédure nationale", "Commercialisée", "01/01/2020", "", "", "LABO", "Non"];
}

function compoRow(i: number, name: string, nature = "SA"): string[] {
	return [cis(i), "comprimé", "1234", name, "10 mg", "un comprimé", nature, "1"];
}

function input(overrides: Partial<BdpmInput> = {}): BdpmInput {
	const cisBdpm = Array.from({ length: 12_000 }, (_, i) => medicineRow(i));
	const compo = Array.from({ length: 25_000 }, (_, i) => compoRow(i % 12_000, `SUBSTANCE ${i % 12_000}`));
	const mitm = Array.from({ length: 6_000 }, (_, i) => [cis(i), "N02BE01", "X", "LABO", "LABO", "01/01/2024", "https://x"]);
	return { cisBdpm, compo, mitm, bannerDate: "2026-09-29", ...overrides };
}

describe("decodeCp1252", () => {
	it("decodes windows-1252 bytes", () => {
		expect(decodeCp1252(new Uint8Array([0x64, 0x92, 0x69, 0x6e, 0x69, 0x74]))).toBe("d’init");
		expect(decodeCp1252(new Uint8Array([0x63, 0x6f, 0x6d, 0x70, 0x72, 0x69, 0x6d, 0xe9]))).toBe("comprimé");
	});
});

describe("parseTsv", () => {
	it("re-exports the shared parser", () => {
		expect(parseTsv).toBe(sharedParseTsv);
	});

	it("splits CRLF lines, trims fields and drops the final empty line", () => {
		expect(parseTsv("a \tb\r\nc\t d \r\n", 2, "F.txt")).toEqual([
			["a", "b"],
			["c", "d"],
		]);
		expect(parseTsv("a\tb\r\nc\td", 2, "F.txt")).toHaveLength(2);
	});

	it("names the file and line on a column-count mismatch", () => {
		expect(() => parseTsv("a\tb\r\nc\r\n", 2, "CIS_bdpm.txt")).toThrow("CIS_bdpm.txt: line 2 has 1 columns, expected 2");
	});
});

describe("parseBanner", () => {
	it("returns the ISO release date", () => {
		expect(parseBanner("<p>\n          Dernière mise à jour le 29/09/2026\n        </p>")).toBe("2026-09-29");
		expect(parseBanner("<p>Derni&egrave;re mise &agrave; jour le 01/10/2026</p>")).toBe("2026-10-01");
	});

	it("returns null when the banner is missing or invalid", () => {
		expect(parseBanner("<p>nothing</p>")).toBeNull();
		expect(parseBanner("Dernière mise à jour le 31/02/2026")).toBeNull();
	});
});

describe("validateAndMap", () => {
	it("rejects a file below its row floor", () => {
		expect(() => validateAndMap(input({ mitm: [] }))).toThrow("CIS_MITM.txt: 0 rows, below the floor of 6000");
	});

	it("rejects an invalid CIS", () => {
		const cisBdpm = input().cisBdpm;
		cisBdpm[41] = medicineRow(41).with(0, "1234567");
		expect(() => validateAndMap(input({ cisBdpm }))).toThrow('CIS_bdpm.txt: line 42 has invalid CIS "1234567"');
	});

	it("rejects an empty MITM ATC", () => {
		const mitm = input().mitm;
		mitm[9] = mitm[9].with(1, "");
		expect(() => validateAndMap(input({ mitm }))).toThrow("CIS_MITM.txt: line 10 has an empty ATC");
	});

	it("rejects a missing banner date", () => {
		expect(() => validateAndMap(input({ bannerDate: null }))).toThrow("release date");
	});

	it("maps medicines with the banner date and null optional fields", () => {
		const cisBdpm = input().cisBdpm;
		cisBdpm[0] = medicineRow(0, "Nifédipine Viatris L.P. 30 mg").with(3, "").with(10, "VIATRIS");
		const { medicines } = validateAndMap(input({ cisBdpm }));
		expect(medicines[0]).toEqual({
			cis: "60000000",
			denomination: "Nifédipine Viatris L.P. 30 mg",
			denomination_norm: "NIFEDIPINE VIATRIS LP 30 MG",
			form: "comprimé",
			routes: null,
			amm_status: "Autorisation active",
			marketing_status: "Commercialisée",
			holder: "VIATRIS",
			bdpm_updated_at: "2026-09-29",
		});
	});

	it("keeps SA substances only", () => {
		const compo = input().compo;
		compo.push(compoRow(1, "FRACTION THERAPEUTIQUE", "FT"));
		const { substances } = validateAndMap(input({ compo }));
		expect(substances).toHaveLength(25_000);
		expect(substances.every((s) => s.nature === "SA")).toBe(true);
	});

	it("counts skipped rows", () => {
		const base = input();
		base.cisBdpm[5] = medicineRow(5, "");
		base.compo.push(compoRow(1, ""));
		base.mitm.push(["99999999", "N02BE01", "X", "", "", "", ""]);
		const { medicines, mitm, fts, skipped } = validateAndMap(base);
		expect(skipped).toEqual({ medicines: 1, substances: 1, mitm: 2 });
		expect(medicines).toHaveLength(11_999);
		expect(fts).toHaveLength(11_999);
		expect(mitm).toHaveLength(5_999);
	});

	it("assembles FTS rows with distinct, sorted substances", () => {
		const compo = input().compo;
		compo.push(compoRow(2, "codéine"), compoRow(2, "Paracétamol"), compoRow(2, "CODEINE"));
		const { fts } = validateAndMap(input({ compo }));
		expect(fts[2]).toEqual({ cis: cis(2), denomination_norm: "MEDICAMENT 2 10 MG COMPRIME", substances_norm: "CODEINE PARACETAMOL SUBSTANCE 2" });
	});
});

describe("sql", () => {
	it("escapes literals", () => {
		expect(sqlLiteral("traitement d'initiation")).toBe("'traitement d''initiation'");
		expect(sqlLiteral(null)).toBe("NULL");
	});

	it("caps every statement at 90,000 bytes on a 5,000-row input", () => {
		const rows = Array.from({ length: 5_000 }, (_, i) => [cis(i), `Dénomination d'essai ${"é".repeat(40)} ${i}`, null]);
		const statements = insertStatements("medicines_fts", ["cis", "denomination_norm", "substances_norm"], rows);
		const encoder = new TextEncoder();
		expect(statements.length).toBeGreaterThan(1);
		for (const s of statements) expect(encoder.encode(s).length).toBeLessThanOrEqual(90_000);
		expect(statements.join("").match(/\),\(/g)?.length).toBe(5_000 - statements.length);
	});

	it("builds the import file without BEGIN/COMMIT", () => {
		const sql = buildImportSql({
			...validateAndMap(input()),
			release: "2026-09-29",
			startedAt: "2026-10-27T10:00:00.000Z",
			finishedAt: "2026-10-27T10:01:00.000Z",
		});
		expect(sql).not.toMatch(/\b(BEGIN|COMMIT)\b/i);
		const lines = sql.trimEnd().split("\n");
		expect(lines.slice(0, 4)).toEqual(["DELETE FROM medicines_fts;", "DELETE FROM mitm;", "DELETE FROM substances;", "DELETE FROM medicines;"]);
		expect(lines.at(-1)).toBe(
			"INSERT INTO ingest_runs (source, started_at, finished_at, status, entries_seen, bdpm_release, message) VALUES " +
				"('bdpm', '2026-10-27T10:00:00.000Z', '2026-10-27T10:01:00.000Z', 'ok', 12000, '2026-09-29', 'medicines=12000 substances=25000 mitm=6000 skipped=0');",
		);
	});
});
