import { describe, expect, it } from "vitest";
import { decodeEntities, ftsTokens, normalize, tokens } from "../src/lib/normalize";

describe("normalize", () => {
	it.each([
		["Brevibloc 100 mg/10 ml, solution injectable en flacon", "BREVIBLOC 100 MG/10 ML SOLUTION INJECTABLE EN FLACON"],
		["ANAPEN 150 µg/0,3 ml", "ANAPEN 150 MCG/0.3 ML"],
		["Nifédipine Viatris L.P. 30 mg", "NIFEDIPINE VIATRIS LP 30 MG"],
		["chlorhydrate d'", "CHLORHYDRATE D"],
		["Winrevair 60mg", "WINREVAIR 60 MG"],
		["seringue pré-remplie", "SERINGUE PREREMPLIE"],
		["1,5 M.U.I.", "1.5 MUI"],
		["<b>Para</b>cétamol", "PARACETAMOL"],
		["&micro;g", "MCG"],
		["cœur", "COEUR"],
	])("%s", (input, expected) => {
		expect(normalize(input)).toBe(expected);
	});

	it("decodes entities and strips tags", () => {
		expect(normalize("chlorhydrate d&#039;amiodarone")).toBe("CHLORHYDRATE D AMIODARONE");
		expect(normalize("<p>Nif&eacute;dipine</p>")).toBe("NIFEDIPINE");
		expect(normalize("a&nbsp;b &amp; c")).toBe("A B C");
	});

	it("decodes Latin-1 and oelig entities", () => {
		expect(decodeEntities("&micro;")).toBe("µ");
		expect(decodeEntities("&deg;")).toBe("°");
		expect(decodeEntities("&oslash;")).toBe("ø");
		expect(decodeEntities("&oelig;&OElig;&aelig;&AElig;&szlig;")).toBe("œŒæÆß");
	});

	it("maps the Œ and Æ ligatures", () => {
		expect(normalize("Œuf ex æquo")).toBe("OEUF EX AEQUO");
		expect(normalize("c&oelig;ur")).toBe("COEUR");
	});

	it("handles typographic apostrophes and dashes", () => {
		expect(normalize("chlorhydrate d’amiodarone")).toBe("CHLORHYDRATE D AMIODARONE");
		expect(normalize("pré – remplie")).toBe("PRE REMPLIE");
		expect(normalize("seringue pré - remplie")).toBe("SERINGUE PRE REMPLIE");
		expect(normalize("seringue pré -remplie")).toBe("SERINGUE PREREMPLIE");
	});

	it("maps the Greek mu like the micro sign", () => {
		expect(normalize("150 μg")).toBe("150 MCG");
	});

	it("normalizes units", () => {
		expect(normalize("500 microgrammes")).toBe("500 MCG");
		expect(normalize("1 microgramme")).toBe("1 MCG");
		expect(normalize("20 milligrammes/5 millilitres")).toBe("20 MG/5 ML");
		expect(normalize("Tramadol L.P. 100mg")).toBe("TRAMADOL LP 100 MG");
		expect(normalize("crème 0,1%")).toBe("CREME 0.1 POUR CENT");
		expect(normalize("10 000 U.I.")).toBe("10 000 UI");
		expect(normalize("MG/4ML")).toBe("MG/4 ML");
	});
});

describe("decodeEntities", () => {
	it("decodes named, accented and numeric entities", () => {
		expect(decodeEntities("&amp;&lt;&gt;&quot;&apos;")).toBe("&<>\"'");
		expect(decodeEntities("&eacute;&egrave;&agrave;&ccedil;&ocirc;&Eacute;")).toBe("éèàçôÉ");
		expect(decodeEntities("&#039;&#233;&#xE9;&#XE8;")).toBe("'ééè");
		expect(decodeEntities("&nbsp;")).toBe(" ");
	});

	it("keeps tags and unknown entities", () => {
		expect(decodeEntities("<b>&unknown;</b>")).toBe("<b>&unknown;</b>");
	});
});

describe("tokens", () => {
	it("splits on spaces and slashes and drops stop-words", () => {
		expect(tokens("SOLUTION INJECTABLE EN FLACON DE 10 ML")).toEqual(["SOLUTION", "INJECTABLE", "FLACON", "10", "ML"]);
		expect(tokens("ANAPEN 150 MCG/0.3 ML")).toEqual(["ANAPEN", "150", "MCG", "0.3", "ML"]);
		expect(tokens("CHLORHYDRATE D AMIODARONE ET L A AU AUX DU DES LA LE LES POUR")).toEqual(["CHLORHYDRATE", "AMIODARONE"]);
		expect(tokens("")).toEqual([]);
	});
});

describe("ftsTokens", () => {
	it("splits tokens on dots", () => {
		expect(ftsTokens("ANAPEN 150 MCG/0.3 ML")).toEqual(["ANAPEN", "150", "MCG", "0", "3", "ML"]);
	});
});
