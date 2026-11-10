import { normalize } from "./normalize";

export const RETURN_PRECISIONS = ["day", "month", "quarter", "year", "season"] as const;
export const RETURN_PARTS = ["debut", "mi", "fin"] as const;

export interface ExpectedReturn {
	earliest: string | null;
	latest: string | null;
	precision: (typeof RETURN_PRECISIONS)[number] | null;
	part: (typeof RETURN_PARTS)[number] | null;
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
	"LA",
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
	"NORMALE",
	"ESTIMEE",
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
const ORDINAL = "(PREMIER|1 ?ER|DEUXIEME|2 ?EME|SECOND|TROISIEME|3 ?EME|QUATRIEME|4 ?EME)";
const RE_PART_QUARTER = new RegExp(`^(DEBUT|MI|FIN) DU ${ORDINAL} TRIMESTRE ${YEAR}`);
const RE_QUARTER = new RegExp(`^${ORDINAL} TRIMESTRE ${YEAR}`);
const RE_SEASON = new RegExp(`^(PRINTEMPS|ETE|AUTOMNE|HIVER) ${YEAR}`);
const RE_PART_YEAR = new RegExp(`^(?:(DEBUT)|(FIN)(?: D ANNEE)?) ${YEAR}`);
const RE_YEAR = new RegExp(`^(?:COURANT )?${YEAR}`);

const pad = (n: number): string => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Inclusive year bounds of a parsed date. */
interface YearBounds {
	min: number;
	max: number;
}

const DEFAULT_YEARS: YearBounds = { min: 2000, max: 2100 };
const yearInRange = (y: number, years: YearBounds = DEFAULT_YEARS): boolean => y >= years.min && y <= years.max;

function validDay(y: number, m: number, d: number, years: YearBounds = DEFAULT_YEARS): string | null {
	if (!yearInRange(y, years) || m < 1 || m > 12 || d < 1 || d > lastDay(y, m)) return null;
	return iso(y, m, d);
}

/** Parses `DD/MM/YYYY` or `D/M/YYYY` into `YYYY-MM-DD` (years 2000–2100 unless `years` says otherwise). */
export function parseFrDate(s: string, years: YearBounds = DEFAULT_YEARS): string | null {
	const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
	if (!m) return null;
	return validDay(Number(m[3]), Number(m[2]), Number(m[1]), years);
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

function quarter(y: number, ordinal: string, part: ExpectedReturn["part"]): ExpectedReturn {
	const q = QUARTERS.find(([re]) => re.test(ordinal))?.[1] as number;
	const first = (q - 1) * 3 + 1;
	return { earliest: iso(y, first, 1), latest: iso(y, first + 2, lastDay(y, first + 2)), precision: "quarter", part };
}

/** First month of each season; a season spans three months, winter running into the next year. */
const SEASONS: Record<string, number> = { PRINTEMPS: 3, ETE: 6, AUTOMNE: 9, HIVER: 12 };

function season(y: number, name: string): ExpectedReturn {
	const first = SEASONS[name] as number;
	const endYear = first === 12 ? y + 1 : y;
	const endMonth = ((first + 1) % 12) + 1;
	return { earliest: iso(y, first, 1), latest: iso(endYear, endMonth, lastDay(endYear, endMonth)), precision: "season", part: null };
}

const PARTS: Record<string, ExpectedReturn["part"]> = { DEBUT: "debut", MI: "mi", FIN: "fin" };
const monthIndex = (name: string): number => MONTHS.indexOf(name) + 1;

/** The words after "DISPOSITION", or after the first whole word "REVIENT" when there is no "DISPOSITION". */
function tailOf(t: string): string | null {
	let rest: string;
	const idx = t.indexOf("DISPOSITION");
	if (idx !== -1) rest = t.slice(idx + "DISPOSITION".length);
	else {
		const m = /(?:^| )REVIENT(?: |$)/.exec(t);
		if (m === null) return null;
		rest = t.slice(m.index + m[0].length);
	}
	const words = rest.split(" ").filter((w) => w !== "");
	while (words.length > 0 && LEADING_WORDS.has(words[0] as string)) words.shift();
	return words.join(" ");
}

/** Whether an ANSM expected-return line states the return is undetermined (including the "indérminée" typo). */
export function isUndetermined(line: string): boolean {
	const t = normalize(line);
	return t.includes("INDETERMINE") || t.includes("INDERMINE");
}

/** Parses an ANSM expected-return line into a date window. Never invents a single day. */
export function parseExpectedReturn(line: string): ExpectedReturn {
	if (isUndetermined(line)) return NONE;
	const t = normalize(line);
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
	if ((m = RE_PART_QUARTER.exec(tail))) {
		y = Number(m[3]);
		return yearInRange(y) ? quarter(y, m[2] as string, PARTS[m[1] as string] ?? null) : NONE;
	}
	if ((m = RE_QUARTER.exec(tail))) {
		y = Number(m[2]);
		return yearInRange(y) ? quarter(y, m[1] as string, null) : NONE;
	}
	if ((m = RE_SEASON.exec(tail))) {
		y = Number(m[2]);
		return yearInRange(y) ? season(y, m[1] as string) : NONE;
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
