import { describe, expect, it } from "vitest";
import { type ExpectedReturn, isUndetermined, parseFrDate, parseReturnWhen } from "../src/lib/dates";

const NONE: ExpectedReturn = { earliest: null, latest: null, precision: null, part: null };
const P = "Date de remise à disposition prévue";

const r = (
	earliest: string,
	latest: string,
	precision: ExpectedReturn["precision"],
	part: ExpectedReturn["part"] = null,
): ExpectedReturn => ({ earliest, latest, precision, part });

describe("parseReturnWhen: measured expressions", () => {
	it.each<[string, ExpectedReturn]>([
		["fin novembre 2026", r("2026-11-01", "2026-11-30", "month", "fin")],
		["février 2027", r("2027-02-01", "2027-02-28", "month")],
		["courant 2026", r("2026-01-01", "2026-12-31", "year")],
		["fin 2026", r("2026-01-01", "2026-12-31", "year", "fin")],
		["deuxième trimestre 2027", r("2027-04-01", "2027-06-30", "quarter")],
		["courant décembre 2026", r("2026-12-01", "2026-12-31", "month")],
		["en octobre 2024", r("2024-10-01", "2024-10-31", "month")],
	])("%s", (expr, expected) => {
		expect(parseReturnWhen(expr)).toEqual(expected);
	});
});

describe("parseReturnWhen: rules", () => {
	it.each<[string, ExpectedReturn]>([
		["Fin Novembre 2026.", r("2026-11-01", "2026-11-30", "month", "fin")],
		["prévue courant 2027", r("2027-01-01", "2027-12-31", "year")],
		["au troisième trimestre 2027", r("2027-07-01", "2027-09-30", "quarter")],
		["le 15/12/2026", r("2026-12-15", "2026-12-15", "day")],
		["le 5/1/2027", r("2027-01-05", "2027-01-05", "day")],
		["le 3 mars 2027", r("2027-03-03", "2027-03-03", "day")],
		["le 1er mars 2027", r("2027-03-01", "2027-03-01", "day")],
		["début février 2028", r("2028-02-01", "2028-02-29", "month", "debut")],
		["mi-avril 2027", r("2027-04-01", "2027-04-30", "month", "mi")],
		["en août 2027", r("2027-08-01", "2027-08-31", "month")],
		["au 1er trimestre 2027", r("2027-01-01", "2027-03-31", "quarter")],
		["au premier trimestre 2027", r("2027-01-01", "2027-03-31", "quarter")],
		["au 2ème trimestre 2027", r("2027-04-01", "2027-06-30", "quarter")],
		["au second trimestre 2027", r("2027-04-01", "2027-06-30", "quarter")],
		["au 3ème trimestre 2027", r("2027-07-01", "2027-09-30", "quarter")],
		["au quatrième trimestre 2027", r("2027-10-01", "2027-12-31", "quarter")],
		["au 4ème trimestre 2027", r("2027-10-01", "2027-12-31", "quarter")],
		["début 2027", r("2027-01-01", "2027-12-31", "year", "debut")],
		["fin d'année 2026", r("2026-01-01", "2026-12-31", "year", "fin")],
		["début d'année 2027", NONE],
		["en 2027", r("2027-01-01", "2027-12-31", "year")],
		["à partir du 10/03/2027", r("2027-03-10", "2027-03-10", "day")],
		["normale estimée deuxième trimestre 2027", r("2027-04-01", "2027-06-30", "quarter")],
		["prochainement", NONE],
		["indéterminée", NONE],
		["inconnue", NONE],
		["", NONE],
	])("%s", (expr, expected) => {
		expect(parseReturnWhen(expr)).toEqual(expected);
	});

	it.each<[string, ExpectedReturn]>([
		["à la fin du troisième trimestre 2026", r("2026-07-01", "2026-09-30", "quarter", "fin")],
		["début du premier trimestre 2027", r("2027-01-01", "2027-03-31", "quarter", "debut")],
		["mi du 2ème trimestre 2027", r("2027-04-01", "2027-06-30", "quarter", "mi")],
		["printemps 2027", r("2027-03-01", "2027-05-31", "season")],
		["été 2027", r("2027-06-01", "2027-08-31", "season")],
		["automne 2027", r("2027-09-01", "2027-11-30", "season")],
		["hiver 2026", r("2026-12-01", "2027-02-28", "season")],
		["hiver 2027", r("2027-12-01", "2028-02-29", "season")],
		["été 1999", NONE],
		["hiver 2101", NONE],
		["fin du troisième trimestre 2924", NONE],
	])("quarter part and season: %s", (expr, expected) => {
		expect(parseReturnWhen(expr)).toEqual(expected);
	});

	it("rejects years outside 2000–2100", () => {
		expect(parseReturnWhen("le 29/11/2924")).toEqual(NONE);
		expect(parseReturnWhen("fin 2924")).toEqual(NONE);
		expect(parseReturnWhen("mars 1999")).toEqual(NONE);
	});

	it("rejects invalid dates", () => {
		expect(parseReturnWhen("le 31/02/2026")).toEqual(NONE);
		expect(parseReturnWhen("le 31 avril 2026")).toEqual(NONE);
	});
});

describe("isUndetermined", () => {
	it("accepts the indéterminée wording and its indérminée typo", () => {
		expect(isUndetermined(`${P} : indéterminée.`)).toBe(true);
		expect(isUndetermined(`${P} INDÉTERMINÉE`)).toBe(true);
		expect(isUndetermined(`${P} indérminée`)).toBe(true);
		expect(isUndetermined("Remise à disposition normale en ville indéterminée")).toBe(true);
	});

	it("accepts the inconnue wording", () => {
		expect(isUndetermined("Date de remise à disposition normale inconnue")).toBe(true);
		expect(isUndetermined("inconnue")).toBe(true);
	});

	it("rejects dated and unparsed lines", () => {
		expect(isUndetermined(`${P} été 2027`)).toBe(false);
		expect(isUndetermined("Date de remise à disposition normale pour le flacon de 100 ml : courant 2026")).toBe(false);
		expect(isUndetermined(`${P} prochainement`)).toBe(false);
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

	it("applies explicit year bounds", () => {
		const years = { min: 1900, max: 2100 };
		expect(parseFrDate("19/05/1964", years)).toBe("1964-05-19");
		expect(parseFrDate("29/11/2924", years)).toBeNull();
		expect(parseFrDate("31/12/1899", years)).toBeNull();
	});
});
