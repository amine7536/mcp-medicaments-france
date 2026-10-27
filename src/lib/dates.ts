import { normalize } from "./normalize";

export interface ExpectedReturn {
	earliest: string | null;
	latest: string | null;
	precision: "day" | "month" | "quarter" | "year" | null;
	part: "debut" | "mi" | "fin" | null;
}

const NONE: ExpectedReturn = { earliest: null, latest: null, precision: null, part: null };

const MONTHS = [
	"JANVIER",
	"FEVRIER",
	"MARS",
	"AVRIL",
	"MAI",
	"JUIN",
	"JUILLET",
	"AOUT",
	"SEPTEMBRE",
	"OCTOBRE",
	"NOVEMBRE",
	"DECEMBRE",
];
const MONTH = `(${MONTHS.join("|")})`;
const YEAR = "(\\d{4})(?= |$)";

const LEADING_WORDS = new Set([
	"PREVUE",
	"PREVU",
	"LE",
	"AU",
	"MIEUX",
	"NIVEAU",
	"DES",
	"LABORATOIRES",
	"EXPLOITANTS",
	"A",
	"PARTIR",
	"DU",
	"EN",
]);

// Ordinals as they appear after normalize() ("1er" becomes "1 ER").
const QUARTERS: Array<[RegExp, number]> = [
	[/^(?:PREMIER|1 ?ER)$/, 1],
	[/^(?:DEUXIEME|2 ?EME|SECOND)$/, 2],
	[/^(?:TROISIEME|3 ?EME)$/, 3],
	[/^(?:QUATRIEME|4 ?EME)$/, 4],
];

const RE_NUMERIC = /^(\d{1,2}\/\d{1,2}\/\d{4})(?= |$)/;
const RE_DAY = new RegExp(`^(?:(1) ER|(\\d{1,2})) ${MONTH} ${YEAR}`);
const RE_PART_MONTH = new RegExp(`^(DEBUT|MI|FIN) ${MONTH} ${YEAR}`);
const RE_MONTH = new RegExp(`^(?:COURANT )?${MONTH} ${YEAR}`);
const RE_QUARTER = new RegExp(`^(PREMIER|1 ?ER|DEUXIEME|2 ?EME|SECOND|TROISIEME|3 ?EME|QUATRIEME|4 ?EME) TRIMESTRE ${YEAR}`);
const RE_PART_YEAR = new RegExp(`^(?:(DEBUT)|(FIN)(?: D ANNEE)?) ${YEAR}`);
const RE_YEAR = new RegExp(`^(?:COURANT )?${YEAR}`);

const pad = (n: number): string => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const yearInRange = (y: number): boolean => y >= 2000 && y <= 2100;

function validDay(y: number, m: number, d: number): string | null {
	if (!yearInRange(y) || m < 1 || m > 12 || d < 1 || d > lastDay(y, m)) return null;
	return iso(y, m, d);
}

/** Parses `DD/MM/YYYY` or `D/M/YYYY` into `YYYY-MM-DD` (years 2000–2100). */
export function parseFrDate(s: string): string | null {
	const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
	if (!m) return null;
	return validDay(Number(m[3]), Number(m[2]), Number(m[1]));
}

function day(date: string): ExpectedReturn {
	return { earliest: date, latest: date, precision: "day", part: null };
}

function month(y: number, m: number, part: ExpectedReturn["part"]): ExpectedReturn {
	return { earliest: iso(y, m, 1), latest: iso(y, m, lastDay(y, m)), precision: "month", part };
}

function year(y: number, part: ExpectedReturn["part"]): ExpectedReturn {
	return { earliest: iso(y, 1, 1), latest: iso(y, 12, 31), precision: "year", part };
}

const PARTS: Record<string, ExpectedReturn["part"]> = { DEBUT: "debut", MI: "mi", FIN: "fin" };
const monthIndex = (name: string): number => MONTHS.indexOf(name) + 1;

function tailOf(t: string): string | null {
	const idx = t.indexOf("DISPOSITION");
	if (idx === -1) return null;
	const words = t.slice(idx + "DISPOSITION".length).split(" ").filter((w) => w !== "");
	while (words.length > 0 && LEADING_WORDS.has(words[0] as string)) words.shift();
	return words.join(" ");
}

/** Parses an ANSM expected-return line into a date window. Never invents a single day. */
export function parseExpectedReturn(line: string): ExpectedReturn {
	const t = normalize(line);
	if (t.includes("INDETERMINE") || t.includes("INDERMINE")) return NONE;
	const tail = tailOf(t);
	if (tail === null) return NONE;

	let m: RegExpExecArray | null;
	let y: number;

	if ((m = RE_NUMERIC.exec(tail))) {
		const date = parseFrDate(m[1] as string);
		return date ? day(date) : NONE;
	}
	if ((m = RE_DAY.exec(tail))) {
		const date = validDay(Number(m[4]), monthIndex(m[3] as string), Number(m[1] ?? m[2]));
		return date ? day(date) : NONE;
	}
	if ((m = RE_PART_MONTH.exec(tail))) {
		y = Number(m[3]);
		return yearInRange(y) ? month(y, monthIndex(m[2] as string), PARTS[m[1] as string] ?? null) : NONE;
	}
	if ((m = RE_MONTH.exec(tail))) {
		y = Number(m[2]);
		return yearInRange(y) ? month(y, monthIndex(m[1] as string), null) : NONE;
	}
	if ((m = RE_QUARTER.exec(tail))) {
		y = Number(m[2]);
		if (!yearInRange(y)) return NONE;
		const q = QUARTERS.find(([re]) => re.test(m?.[1] as string))?.[1] as number;
		const first = (q - 1) * 3 + 1;
		return {
			earliest: iso(y, first, 1),
			latest: iso(y, first + 2, lastDay(y, first + 2)),
			precision: "quarter",
			part: null,
		};
	}
	if ((m = RE_PART_YEAR.exec(tail))) {
		y = Number(m[3]);
		return yearInRange(y) ? year(y, PARTS[(m[1] ?? m[2]) as string] ?? null) : NONE;
	}
	if ((m = RE_YEAR.exec(tail))) {
		y = Number(m[1]);
		return yearInRange(y) ? year(y, null) : NONE;
	}
	return NONE;
}
