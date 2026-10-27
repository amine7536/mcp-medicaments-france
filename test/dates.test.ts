import { describe, expect, it } from "vitest";
import { type ExpectedReturn, parseExpectedReturn, parseFrDate } from "../src/lib/dates";

const NONE: ExpectedReturn = { earliest: null, latest: null, precision: null, part: null };
const P = "Date de remise à disposition prévue";

const r = (
	earliest: string,
	latest: string,
	precision: ExpectedReturn["precision"],
	part: ExpectedReturn["part"] = null,
): ExpectedReturn => ({ earliest, latest, precision, part });

describe("parseExpectedReturn: spec cases", () => {
	it.each<[string, ExpectedReturn]>([
		[`${P} fin novembre 2026`, r("2026-11-01", "2026-11-30", "month", "fin")],
		[`${P} : fin 2026`, r("2026-01-01", "2026-12-31", "year", "fin")],
		[`${P}, au mieux, fin 2026`, r("2026-01-01", "2026-12-31", "year", "fin")],
		[
			"Date de remise à disposition au niveau des laboratoires exploitants : fin novembre 2026. Un délai peut être nécessaire",
			r("2026-11-01", "2026-11-30", "month", "fin"),
		],
		["Remise à disposition prévue indéterminée", NONE],
		[`${P} courant 2027`, r("2027-01-01", "2027-12-31", "year")],
		[`${P} au troisième trimestre 2027`, r("2027-07-01", "2027-09-30", "quarter")],
		[`${P} le 15/12/2026`, r("2026-12-15", "2026-12-15", "day")],
		["Mise à jour du 27 janvier 2016 : remise à disposition prévue prochainement", NONE],
	])("%s", (line, expected) => {
		expect(parseExpectedReturn(line)).toEqual(expected);
	});
});

describe("parseExpectedReturn: rules", () => {
	it.each<[string, ExpectedReturn]>([
		[`${P} le 5/1/2027`, r("2027-01-05", "2027-01-05", "day")],
		[`${P} le 3 mars 2027`, r("2027-03-03", "2027-03-03", "day")],
		[`${P} début février 2028`, r("2028-02-01", "2028-02-29", "month", "debut")],
		[`${P} mi-avril 2027`, r("2027-04-01", "2027-04-30", "month", "mi")],
		[`${P} en août 2027`, r("2027-08-01", "2027-08-31", "month")],
		[`${P} courant décembre 2026`, r("2026-12-01", "2026-12-31", "month")],
		[`${P} au 1er trimestre 2027`, r("2027-01-01", "2027-03-31", "quarter")],
		[`${P} au premier trimestre 2027`, r("2027-01-01", "2027-03-31", "quarter")],
		[`${P} au 2ème trimestre 2027`, r("2027-04-01", "2027-06-30", "quarter")],
		[`${P} au second trimestre 2027`, r("2027-04-01", "2027-06-30", "quarter")],
		[`${P} au 3ème trimestre 2027`, r("2027-07-01", "2027-09-30", "quarter")],
		[`${P} au quatrième trimestre 2027`, r("2027-10-01", "2027-12-31", "quarter")],
		[`${P} au 4ème trimestre 2027`, r("2027-10-01", "2027-12-31", "quarter")],
		[`${P} début 2027`, r("2027-01-01", "2027-12-31", "year", "debut")],
		[`${P} fin d'année 2026`, r("2026-01-01", "2026-12-31", "year", "fin")],
		[`${P} en 2027`, r("2027-01-01", "2027-12-31", "year")],
		[`${P} à partir du 10/03/2027`, r("2027-03-10", "2027-03-10", "day")],
		[`${P} prochainement`, NONE],
		["Rupture de stock", NONE],
	])("%s", (line, expected) => {
		expect(parseExpectedReturn(line)).toEqual(expected);
	});

	it("treats the indérminée typo as indeterminate", () => {
		expect(parseExpectedReturn(`${P} indérminée`)).toEqual(NONE);
	});

	it("rejects years outside 2000–2100", () => {
		expect(parseExpectedReturn(`${P} le 29/11/2924`)).toEqual(NONE);
		expect(parseExpectedReturn(`${P} fin 2924`)).toEqual(NONE);
		expect(parseExpectedReturn(`${P} mars 1999`)).toEqual(NONE);
	});

	it("rejects invalid dates", () => {
		expect(parseExpectedReturn(`${P} le 31/02/2026`)).toEqual(NONE);
		expect(parseExpectedReturn(`${P} le 31 avril 2026`)).toEqual(NONE);
	});
});

describe("parseFrDate", () => {
	it.each<[string, string | null]>([
		["15/12/2026", "2026-12-15"],
		["5/1/2027", "2027-01-05"],
		[" 29/02/2028 ", "2028-02-29"],
		["29/02/2027", null],
		["31/02/2026", null],
		["29/11/2924", null],
		["01/01/1999", null],
		["2026-12-15", null],
		["", null],
	])("%s", (input, expected) => {
		expect(parseFrDate(input)).toBe(expected);
	});
});
