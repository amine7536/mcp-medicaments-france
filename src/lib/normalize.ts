import { decodeHTML } from "entities/decode";

/** Decodes HTML entities (all HTML5 named references, decimal and hex numeric). */
export function decodeEntities(s: string): string {
	return decodeHTML(s);
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
