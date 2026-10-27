// Standard ISO-8859-1 entity names for U+00A0–U+00FF, in code point order.
const LATIN1_NAMES = (
	"nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr " +
	"deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
	"Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml " +
	"ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
	"agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml " +
	"eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml"
).split(" ");

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	oelig: "œ",
	OElig: "Œ",
};

LATIN1_NAMES.forEach((name, i) => {
	NAMED_ENTITIES[name] = String.fromCharCode(0xa0 + i);
});

const ENTITY_RE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g;

function fromCodePoint(cp: number, fallback: string): string {
	return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : fallback;
}

/** Decodes HTML entities (basic, Latin-1, oelig/OElig, decimal and hex numeric). */
export function decodeEntities(s: string): string {
	return s.replace(ENTITY_RE, (match, dec?: string, hex?: string, name?: string) => {
		if (dec !== undefined) return fromCodePoint(Number.parseInt(dec, 10), match);
		if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16), match);
		return NAMED_ENTITIES[name as string] ?? match;
	});
}

const UNIT_RULES: Array<[RegExp, string]> = [
	[/M\.U\.I\./g, "MUI"],
	[/U\.I\./g, "UI"],
	[/[µΜ]G/g, "MCG"],
	[/MICROGRAMMES?/g, "MCG"],
	[/MILLIGRAMMES?/g, "MG"],
	[/MILLILITRES?/g, "ML"],
	[/L\.P\./g, "LP"],
	[/%/g, " POUR CENT "],
];

/** Normalizes a medicine name or free text for matching and full-text search. */
export function normalize(s: string): string {
	let t = decodeEntities(s.replace(/<[^>]*>/g, ""));
	t = t.replace(/[’‘]/g, "'").replace(/[–—]/g, "-");
	t = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
	t = t.replace(/Œ/g, "OE").replace(/Æ/g, "AE");
	t = t.replace(/\bPRE ?-(?=[A-Z])/g, "PRE");
	for (const [re, to] of UNIT_RULES) t = t.replace(re, to);
	t = t.replace(/(\d),(?=\d)/g, "$1.");
	t = t.replace(/(\d)(?=[A-Z])/g, "$1 ").replace(/([A-Z])(?=\d)/g, "$1 ");
	t = t.replace(/[^A-Z0-9/. ]/g, " ").replace(/(?<!\d)\.|\.(?!\d)/g, " ");
	return t.replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set(["DE", "DU", "DES", "LA", "LE", "LES", "EN", "ET", "POUR", "A", "AU", "AUX", "D", "L"]);

/** Splits a normalized string into significant tokens. */
export function tokens(norm: string): string[] {
	return norm.split(/[ /]+/).filter((tok) => tok !== "" && !STOP_WORDS.has(tok));
}

/** Tokens as indexed by the FTS5 `unicode61` tokenizer (dots are separators). */
export function ftsTokens(norm: string): string[] {
	return tokens(norm).flatMap((tok) => tok.split(".").filter((part) => part !== ""));
}
