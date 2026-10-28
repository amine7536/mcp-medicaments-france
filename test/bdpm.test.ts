import { describe, expect, it } from "vitest";
import { fetchBytes } from "../scripts/bdpm/download";
import { parseAnchor, parseApproval, parsePrice, parseRates, validateAndMap, type BdpmInput } from "../scripts/bdpm/map";
import { decodeCp1252, decodeUtf8, parseBanner, parseTsv } from "../scripts/bdpm/parse";
import { buildImportSql, insertStatements, sqlLiteral } from "../scripts/bdpm/sql";
import { USER_AGENT } from "../src/ingest/http";
import { parseTsv as sharedParseTsv } from "../src/lib/tsv";

const cis = (i: number): string => String(60_000_000 + i);

function medicineRow(i: number, denomination = `MEDICAMENT ${i} 10 mg, comprimé`): string[] {
	return [cis(i), denomination, "comprimé", "orale", "Autorisation active", "Procédure nationale", "Commercialisée", "01/01/2020", "", "", "LABO", "Non"];
}

function compoRow(i: number, name: string, nature = "SA"): string[] {
	return [cis(i), "comprimé", "1234", name, "10 mg", "un comprimé", nature, "1"];
}

const cip13 = (i: number): string => String(3_400_900_000_000 + i);

function presentationRow(i: number): string[] {
	return [
		cis(i % 12_000),
		String(4_900_000 + i),
		"plaquette(s) PVC PVDC aluminium de 30 comprimé(s)",
		"Présentation active",
		"Déclaration de commercialisation",
		"16/03/2011",
		cip13(i),
		"oui",
		"100%",
		"24,34",
		"25,36",
		"1,02",
		"",
	];
}

const anchor = (href: string, text: string, quote = "'"): string =>
	`<a target='_blank'  title="Lien direct vers l'information importante sur le site de l'ANSM - Nouvelle fen&ecirc;tre" href=${quote}${href}${quote}>${text}</a>`;

function safetyRow(i: number): string[] {
	return [cis(i), "2026-01-15", "2027-01-15", anchor("https://ansm.sante.fr/actualites/protoxyde-dazote-des-intoxications-en-hausse", "Protoxyde d'azote : des intoxications en hausse")];
}

function input(overrides: Partial<BdpmInput> = {}): BdpmInput {
	const cisBdpm = Array.from({ length: 12_000 }, (_, i) => medicineRow(i));
	const compo = Array.from({ length: 25_000 }, (_, i) => compoRow(i % 12_000, `SUBSTANCE ${i % 12_000}`));
	const mitm = Array.from({ length: 6_000 }, (_, i) => [cis(i), "N02BE01", "X", "LABO", "LABO", "01/01/2024", "https://x"]);
	const presentations = Array.from({ length: 15_000 }, (_, i) => presentationRow(i));
	const prescriptionConditions = Array.from({ length: 20_000 }, (_, i) => [cis(Math.floor(i / 2)), i % 2 === 0 ? "liste I" : "prescription hospitalière"]);
	const safetyInformation = Array.from({ length: 5_000 }, (_, i) => safetyRow(i));
	return { cisBdpm, compo, mitm, presentations, prescriptionConditions, safetyInformation, bannerDate: "2026-09-29", ...overrides };
}

describe("decodeCp1252", () => {
	it("decodes windows-1252 bytes", () => {
		expect(decodeCp1252(new Uint8Array([0x64, 0x92, 0x69, 0x6e, 0x69, 0x74]))).toBe("d’init");
		expect(decodeCp1252(new Uint8Array([0x63, 0x6f, 0x6d, 0x70, 0x72, 0x69, 0x6d, 0xe9]))).toBe("comprimé");
	});
});

describe("decodeUtf8", () => {
	it("decodes UTF-8 bytes and rejects invalid UTF-8", () => {
		expect(decodeUtf8(new TextEncoder().encode("Présentation abrogée\tDéclaration d'arrêt"))).toBe("Présentation abrogée\tDéclaration d'arrêt");
		expect(() => decodeUtf8(new Uint8Array([0x63, 0x6f, 0x6d, 0x70, 0x72, 0x69, 0x6d, 0xe9]))).toThrow();
	});
});

describe("fetchBytes", () => {
	it("downloads through the shared GET (User-Agent and timeout)", async () => {
		const inits: (RequestInit | undefined)[] = [];
		const bytes = await fetchBytes(async (_url, init) => {
			inits.push(init);
			return new Response(new Uint8Array([1, 2, 3]));
		}, "https://x/f.txt");
		expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
		expect(new Headers(inits[0]?.headers).get("User-Agent")).toBe(USER_AGENT);
		expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
	});

	it("throws on a non-200 status", async () => {
		await expect(fetchBytes(async () => new Response("", { status: 503 }), "https://x/f.txt")).rejects.toThrow("https://x/f.txt: HTTP 503");
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

describe("presentations", () => {
	it("parses prices: the last comma is the decimal separator", () => {
		expect(parsePrice("24,34")).toBe(24.34);
		expect(parsePrice("1,466,29")).toBe(1466.29);
		expect(parsePrice("1,02")).toBe(1.02);
		expect(parsePrice("")).toBeNull();
		expect(() => parsePrice("n/a")).toThrow('CIS_CIP_bdpm.txt: invalid price "n/a"');
	});

	it.each(["1e3", "0x10", "-1,00", "1.466,29"])("rejects the price %s", (price) => {
		expect(() => parsePrice(price)).toThrow(`CIS_CIP_bdpm.txt: invalid price "${price}"`);
	});

	it("parses reimbursement rates into a JSON array in source order", () => {
		expect(parseRates("65%")).toBe("[65]");
		expect(parseRates("65 %")).toBe("[65]");
		expect(parseRates("100%;65%")).toBe("[100,65]");
		expect(parseRates("")).toBeNull();
	});

	it("maps oui/non to 1/0, anything else to null", () => {
		expect(parseApproval("oui")).toBe(1);
		expect(parseApproval("non")).toBe(0);
		expect(parseApproval("")).toBeNull();
	});

	it("rejects a line without 13 columns", () => {
		expect(() => parseTsv("a\tb\n", 13, "CIS_CIP_bdpm.txt")).toThrow("CIS_CIP_bdpm.txt: line 1 has 2 columns, expected 13");
	});

	it("rejects a file below 15,000 rows", () => {
		expect(() => validateAndMap(input({ presentations: input().presentations.slice(1) }))).toThrow(
			"CIS_CIP_bdpm.txt: 14999 rows, below the floor of 15000",
		);
	});

	it("rejects an invalid CIP13 or CIS", () => {
		const badCip = input().presentations;
		badCip[3] = presentationRow(3).with(6, "340094949729");
		expect(() => validateAndMap(input({ presentations: badCip }))).toThrow('CIS_CIP_bdpm.txt: line 4 has invalid CIP13 "340094949729"');
		const badCis = input().presentations;
		badCis[4] = presentationRow(4).with(0, "6000228");
		expect(() => validateAndMap(input({ presentations: badCis }))).toThrow('CIS_CIP_bdpm.txt: line 5 has invalid CIS "6000228"');
	});

	it("keeps declaration dates from 1900 to 2100", () => {
		const presentations = input().presentations;
		presentations[2] = presentationRow(2).with(5, "19/05/1964");
		presentations[3] = presentationRow(3).with(5, "01/01/1899");
		const { presentations: rows } = validateAndMap(input({ presentations }));
		expect(rows[2]?.declared_at).toBe("1964-05-19");
		expect(rows[3]?.declared_at).toBeNull();
	});

	it("maps a row, with null optional fields and out-of-range dates", () => {
		const presentations = input().presentations;
		presentations[1] = ["60002283", "", "flacon", "Présentation abrogée", "", "29/11/2924", cip13(1), "", "", "", "1,466,29", "", "Traitement d'appoint"];
		const { presentations: rows } = validateAndMap(input({ presentations }));
		expect(rows).toHaveLength(15_000);
		expect(rows[0]).toEqual({
			cip13: cip13(0),
			cip7: "4900000",
			cis: cis(0),
			label: "plaquette(s) PVC PVDC aluminium de 30 comprimé(s)",
			admin_status: "Présentation active",
			marketing_status: "Déclaration de commercialisation",
			declared_at: "2011-03-16",
			hospital_approval: 1,
			reimbursement_rates: "[100]",
			price_eur: 24.34,
			public_price_eur: 25.36,
			dispensing_fee_eur: 1.02,
			reimbursement_indications: null,
		});
		expect(rows[1]).toEqual({
			cip13: cip13(1),
			cip7: null,
			cis: "60002283",
			label: "flacon",
			admin_status: "Présentation abrogée",
			marketing_status: null,
			declared_at: null,
			hospital_approval: null,
			reimbursement_rates: null,
			price_eur: null,
			public_price_eur: 1466.29,
			dispensing_fee_eur: null,
			reimbursement_indications: "Traitement d'appoint",
		});
	});
});

describe("prescription conditions", () => {
	it("decodes a windows-1252 condition", () => {
		const bytes = new Uint8Array([
			...new TextEncoder().encode("60000001\tr"),
			0xe9,
			...new TextEncoder().encode("serv"),
			0xe9,
			0x20,
			0xe0,
			...new TextEncoder().encode(" l'usage HOSPITALIER\r\n"),
		]);
		expect(parseTsv(decodeCp1252(bytes), 2, "CIS_CPD_bdpm.txt")).toEqual([["60000001", "réservé à l'usage HOSPITALIER"]]);
	});

	it("rejects a line without 2 columns", () => {
		expect(() => parseTsv("60000001\tliste I\textra\n", 2, "CIS_CPD_bdpm.txt")).toThrow("CIS_CPD_bdpm.txt: line 1 has 3 columns, expected 2");
		expect(() => parseTsv("60000001\n", 2, "CIS_CPD_bdpm.txt")).toThrow("CIS_CPD_bdpm.txt: line 1 has 1 columns, expected 2");
	});

	it("rejects a file below 20,000 rows", () => {
		expect(() => validateAndMap(input({ prescriptionConditions: input().prescriptionConditions.slice(1) }))).toThrow(
			"CIS_CPD_bdpm.txt: 19999 rows, below the floor of 20000",
		);
	});

	it("rejects an invalid CIS or an empty condition", () => {
		const badCis = input().prescriptionConditions;
		badCis[2] = ["6000001", "liste I"];
		expect(() => validateAndMap(input({ prescriptionConditions: badCis }))).toThrow('CIS_CPD_bdpm.txt: line 3 has invalid CIS "6000001"');
		const empty = input().prescriptionConditions;
		empty[6] = [cis(3), ""];
		expect(() => validateAndMap(input({ prescriptionConditions: empty }))).toThrow("CIS_CPD_bdpm.txt: line 7 has an empty condition");
	});

	it("keeps verbatim conditions in source order per CIS and drops repeated pairs", () => {
		const rows = input().prescriptionConditions;
		rows[0] = [cis(0), "prescription hospitalière"];
		rows[1] = [cis(0), "liste I"];
		rows[2] = [cis(0), "prescription hospitalière"];
		rows[3] = [cis(0), "réservé à l'usage HOSPITALIER"];
		const { prescription_conditions: out } = validateAndMap(input({ prescriptionConditions: rows }));
		expect(out).toHaveLength(19_999);
		expect(out.filter((r) => r.cis === cis(0))).toEqual([
			{ cis: cis(0), condition: "prescription hospitalière", position: 1 },
			{ cis: cis(0), condition: "liste I", position: 2 },
			{ cis: cis(0), condition: "réservé à l'usage HOSPITALIER", position: 3 },
		]);
		expect(out.filter((r) => r.cis === cis(2))).toEqual([
			{ cis: cis(2), condition: "liste I", position: 1 },
			{ cis: cis(2), condition: "prescription hospitalière", position: 2 },
		]);
	});
});

describe("safety information", () => {
	it("decodes the UTF-8 live file into 4 columns", () => {
		const bytes = new TextEncoder().encode(`60000001\t2026-01-15\t2027-01-15\t${anchor("https://ansm.sante.fr/x", "Irinotécan")}\n`);
		expect(parseTsv(decodeUtf8(bytes), 4, "CIS_InfoImportantes.txt")).toEqual([["60000001", "2026-01-15", "2027-01-15", anchor("https://ansm.sante.fr/x", "Irinotécan")]]);
		expect(() => parseTsv("60000001\t2026-01-15\t2027-01-15\n", 4, "CIS_InfoImportantes.txt")).toThrow("CIS_InfoImportantes.txt: line 1 has 3 columns, expected 4");
	});

	it("parses the href in single or double quotes and the decoded inner text, not the title attribute", () => {
		for (const quote of ["'", '"']) {
			expect(parseAnchor(anchor("https://www.ansm.sante.fr/a", "Valproate &amp; grossesse : d&eacute;marches", quote))).toEqual({
				url: "https://www.ansm.sante.fr/a",
				title: "Valproate & grossesse : démarches",
			});
		}
		expect(parseAnchor(anchor("https://ansm.sante.fr/a", " dose d'irinotécan > 180 mg/m² "))).toEqual({ url: "https://ansm.sante.fr/a", title: "dose d'irinotécan > 180 mg/m²" });
		expect(parseAnchor(anchor("https://ansm.sante.fr/a", "x"))?.title).not.toContain("fenêtre");
		expect(parseAnchor("Protoxyde d'azote")).toBeNull();
		expect(parseAnchor("<a target='_blank'>sans lien</a>")).toBeNull();
	});

	it("maps rows and keeps an http:// ANSM URL as published", () => {
		const rows = input().safetyInformation;
		rows[1] = [cis(1), "2026-02-01", "2026-12-31", anchor("http://ansm.sante.fr/Activites/RTU/GYMISO", "RTU de Gymiso et Misoone")];
		const { safety_information: out } = validateAndMap(input({ safetyInformation: rows }));
		expect(out).toHaveLength(5_000);
		expect(out[0]).toEqual({
			cis: cis(0),
			title: "Protoxyde d'azote : des intoxications en hausse",
			url: "https://ansm.sante.fr/actualites/protoxyde-dazote-des-intoxications-en-hausse",
			starts_on: "2026-01-15",
			ends_on: "2027-01-15",
		});
		expect(out[1]).toEqual({ cis: cis(1), title: "RTU de Gymiso et Misoone", url: "http://ansm.sante.fr/Activites/RTU/GYMISO", starts_on: "2026-02-01", ends_on: "2026-12-31" });
	});

	it("rejects a file below 5,000 rows", () => {
		expect(() => validateAndMap(input({ safetyInformation: input().safetyInformation.slice(1) }))).toThrow(
			"CIS_InfoImportantes.txt: 4999 rows, below the floor of 5000",
		);
	});

	it("rejects an invalid CIS, a non-ISO date, a missing anchor, a non-ANSM URL or an empty title", () => {
		const bad = (i: number, row: string[]): BdpmInput => {
			const rows = input().safetyInformation;
			rows[i] = row;
			return input({ safetyInformation: rows });
		};
		const ok = safetyRow(0);
		expect(() => validateAndMap(bad(2, ["6000001", ok[1], ok[2], ok[3]]))).toThrow('CIS_InfoImportantes.txt: line 3 has invalid CIS "6000001"');
		expect(() => validateAndMap(bad(3, [cis(3), "15/01/2026", ok[2], ok[3]]))).toThrow('CIS_InfoImportantes.txt: line 4 has invalid start date "15/01/2026", expected YYYY-MM-DD');
		expect(() => validateAndMap(bad(4, [cis(4), ok[1], "", ok[3]]))).toThrow('CIS_InfoImportantes.txt: line 5 has invalid end date "", expected YYYY-MM-DD');
		expect(() => validateAndMap(bad(5, [cis(5), ok[1], ok[2], "Protoxyde d'azote"]))).toThrow("CIS_InfoImportantes.txt: line 6 has no anchor with an href");
		for (const url of ["https://example.com/ansm.sante.fr/", "https://ansm.sante.fr.evil.com/x", "ftp://ansm.sante.fr/x", "https://sante.fr/x"]) {
			expect(() => validateAndMap(bad(6, [cis(6), ok[1], ok[2], anchor(url, "titre")]))).toThrow(`CIS_InfoImportantes.txt: line 7 has a non-ANSM URL "${url}"`);
		}
		expect(() => validateAndMap(bad(7, [cis(7), ok[1], ok[2], anchor("https://ansm.sante.fr/x", " <b> </b> ")]))).toThrow(
			"CIS_InfoImportantes.txt: line 8 has an empty title",
		);
	});
});

describe("sql", () => {
	it("escapes literals", () => {
		expect(sqlLiteral("traitement d'initiation")).toBe("'traitement d''initiation'");
		expect(sqlLiteral(null)).toBe("NULL");
		expect(sqlLiteral(1466.29)).toBe("1466.29");
		expect(() => sqlLiteral(Number.NaN)).toThrow();
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
		expect(lines.slice(0, 7)).toEqual([
			"DELETE FROM medicines_fts;",
			"DELETE FROM mitm;",
			"DELETE FROM substances;",
			"DELETE FROM medicines;",
			"DELETE FROM presentations;",
			"DELETE FROM prescription_conditions;",
			"DELETE FROM safety_information;",
		]);
		expect(sql).toContain(
			"INSERT INTO safety_information (cis, title, url, starts_on, ends_on) VALUES ('60000000','Protoxyde d''azote : des intoxications en hausse','https://ansm.sante.fr/actualites/protoxyde-dazote-des-intoxications-en-hausse','2026-01-15','2027-01-15'),",
		);
		expect(sql).toContain("INSERT INTO prescription_conditions (cis, condition, position) VALUES ('60000000','liste I',1),('60000000','prescription hospitalière',2),");
		expect(sql).toContain(
			"INSERT INTO presentations (cip13, cip7, cis, label, admin_status, marketing_status, declared_at, hospital_approval, reimbursement_rates, price_eur, public_price_eur, dispensing_fee_eur, reimbursement_indications) VALUES " +
				"('3400900000000','4900000','60000000','plaquette(s) PVC PVDC aluminium de 30 comprimé(s)','Présentation active','Déclaration de commercialisation','2011-03-16',1,'[100]',24.34,25.36,1.02,NULL),",
		);
		expect(lines.at(-1)).toBe(
			"INSERT INTO ingest_runs (source, started_at, finished_at, status, entries_seen, bdpm_release, message) VALUES " +
				"('bdpm', '2026-10-27T10:00:00.000Z', '2026-10-27T10:01:00.000Z', 'ok', 12000, '2026-09-29', 'medicines=12000 substances=25000 mitm=6000 presentations=15000 prescription_conditions=20000 safety_information=5000 skipped=0');",
		);
	});
});
