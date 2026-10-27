const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	aelig: "æ",
	AElig: "Æ",
	oelig: "œ",
	OElig: "Œ",
	szlig: "ß",
};

// Accented Latin letters: `&eacute;`, `&Egrave;`, `&ccedil;`, `&ocirc;`, ...
const ACCENT_MARKS: Record<string, string> = {
	grave: "̀",
	acute: "́",
	circ: "̂",
	tilde: "̃",
	uml: "̈",
	ring: "̊",
	cedil: "̧",
};

for (const letter of "aceinouyAEINOUYC") {
	for (const [name, mark] of Object.entries(ACCENT_MARKS)) {
		const composed = (letter + mark).normalize("NFC");
		if (composed.length === 1) NAMED_ENTITIES[letter + name] = composed;
	}
}

const ENTITY_RE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g;

function fromCodePoint(cp: number, fallback: string): string {
	return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : fallback;
}

/** Decodes HTML entities (named, accented Latin-1, decimal and hex numeric). */
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
	let t = decodeEntities(s.replace(/<[^>]*>/g, " "));
	t = t.replace(/[’‘]/g, "'").replace(/[–—]/g, "-");
	t = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
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
