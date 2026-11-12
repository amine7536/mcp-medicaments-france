import * as z from "zod";
import { validate } from "./map";
import { insertStatements } from "./sql";

export const HAS_FILES = {
	smr: { name: "CIS_HAS_SMR_bdpm.txt", cols: 6, floor: 12_000 },
	asmr: { name: "CIS_HAS_ASMR_bdpm.txt", cols: 6, floor: 7_500 },
	ctLinks: { name: "HAS_LiensPageCT_bdpm.txt", cols: 2, floor: 8_000 },
} as const;

/** Creates the HAS opinions table when missing (same statement as migration 0014), so the import works before or after that migration. */
export const HAS_OPINIONS_CREATE =
	"CREATE TABLE IF NOT EXISTS has_opinions (cis TEXT NOT NULL, kind TEXT NOT NULL, dossier TEXT NOT NULL, motif TEXT NOT NULL, opinion_date TEXT NOT NULL, value TEXT NOT NULL, position INTEGER NOT NULL)";
/** Index of the HAS opinions table (same statement as migration 0014). */
export const HAS_OPINIONS_INDEX = "CREATE INDEX IF NOT EXISTS idx_has_opinions_cis ON has_opinions (cis)";
/** Creates the HAS opinion page table when missing (same statement as migration 0014). */
export const HAS_CT_LINKS_CREATE = "CREATE TABLE IF NOT EXISTS has_ct_links (dossier TEXT PRIMARY KEY, url TEXT NOT NULL)";

export type HasKind = "smr" | "asmr";

/** One SMR or ASMR row of a known medicine, without its label. */
export interface HasOpinionRow {
	cis: string;
	kind: HasKind;
	dossier: string;
	motif: string;
	/** `YYYY-MM-DD`. */
	opinion_date: string;
	value: string;
	/** 1-based order of the kept row within its kind, in file order. */
	position: number;
}

/** The HAS opinion page of a dossier that has exactly one page. */
export interface HasCtLinkRow {
	dossier: string;
	url: string;
}

export interface HasInput {
	smr: string[][];
	asmr: string[][];
	ctLinks: string[][];
}

export interface HasMapped {
	opinions: HasOpinionRow[];
	ct_links: HasCtLinkRow[];
	/** Rows skipped because their CIS is not an imported medicine. */
	skipped: Record<HasKind, number>;
	/** Dossiers of the links file with more than one distinct page, none of them stored. */
	multiPageDossiers: number;
}

const DOSSIER_RE = /^CT-\d+$/;
const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const HAS_URL_RE = /^https:\/\/www\.has-sante\.fr\//;
const ISO_DATE = z.iso.date();
const req = (v: string | undefined): string => v ?? "";

/**
 * Validates an SMR or ASMR file (columns: CIS, dossier, motif, date `YYYYMMDD`, value, label) and maps the rows of `known` CIS,
 * the label dropped; a repeated (cis, dossier, motif, date, value) keeps its first occurrence. Throws on any invalid row.
 */
function mapOpinions(rows: string[][], kind: HasKind, known: ReadonlySet<string>): { opinions: HasOpinionRow[]; skipped: number } {
	const file = HAS_FILES[kind];
	validate(rows, file);
	const opinions: HasOpinionRow[] = [];
	const seen = new Set<string>();
	let skipped = 0;
	rows.forEach((row, i) => {
		const line = `${file.name}: line ${i + 1}`;
		const [cis, dossier, motif, date, value] = [req(row[0]), req(row[1]), req(row[2]), req(row[3]), req(row[4])];
		if (!DOSSIER_RE.test(dossier)) throw new Error(`${line} has invalid dossier "${dossier}", expected CT- and digits`);
		if (motif === "") throw new Error(`${line} has an empty motif, expected a non-empty value`);
		const m = DATE_RE.exec(date);
		const iso = m ? `${m[1]}-${m[2]}-${m[3]}` : "";
		if (!ISO_DATE.safeParse(iso).success) throw new Error(`${line} has invalid date "${date}", expected YYYYMMDD`);
		if (value === "") throw new Error(`${line} has an empty value, expected a non-empty value`);
		if (!known.has(cis)) {
			skipped++;
			return;
		}
		const key = [cis, dossier, motif, iso, value].join("\t");
		if (seen.has(key)) return;
		seen.add(key);
		opinions.push({ cis, kind, dossier, motif, opinion_date: iso, value, position: opinions.length + 1 });
	});
	return { opinions, skipped };
}

/** Validates the links file (columns: dossier, URL) and keeps the page of each dossier with exactly one distinct page that a kept opinion references. */
function mapCtLinks(rows: string[][], referenced: ReadonlySet<string>): { ct_links: HasCtLinkRow[]; multiPageDossiers: number } {
	const file = HAS_FILES.ctLinks;
	if (rows.length < file.floor) throw new Error(`${file.name}: ${rows.length} rows, below the floor of ${file.floor}`);
	const pages = new Map<string, Set<string>>();
	rows.forEach((row, i) => {
		const line = `${file.name}: line ${i + 1}`;
		const [dossier, url] = [req(row[0]), req(row[1])];
		if (!DOSSIER_RE.test(dossier)) throw new Error(`${line} has invalid dossier "${dossier}", expected CT- and digits`);
		if (!HAS_URL_RE.test(url)) throw new Error(`${line} has a non-HAS URL "${url}"`);
		let urls = pages.get(dossier);
		if (!urls) pages.set(dossier, (urls = new Set()));
		urls.add(url);
	});
	const ct_links: HasCtLinkRow[] = [];
	let multiPageDossiers = 0;
	for (const [dossier, urls] of pages) {
		if (urls.size > 1) {
			multiPageDossiers++;
			continue;
		}
		if (referenced.has(dossier)) ct_links.push({ dossier, url: [...urls][0] as string });
	}
	return { ct_links, multiPageDossiers };
}

/** Validates the three HAS files and maps the opinions of the `known` CIS (the imported medicines) and their single-page dossiers' links. Throws on any validation failure. */
export function mapHas({ smr, asmr, ctLinks }: HasInput, known: ReadonlySet<string>): HasMapped {
	const s = mapOpinions(smr, "smr", known);
	const a = mapOpinions(asmr, "asmr", known);
	const opinions = [...s.opinions, ...a.opinions];
	const { ct_links, multiPageDossiers } = mapCtLinks(ctLinks, new Set(opinions.map((o) => o.dossier)));
	return { opinions, ct_links, skipped: { smr: s.skipped, asmr: a.skipped }, multiPageDossiers };
}

const OPINION_COLS = ["cis", "kind", "dossier", "motif", "opinion_date", "value", "position"] as const;
const LINK_COLS = ["dossier", "url"] as const;

/** HAS statements of the import file: creates the tables if missing, deletes, then size-capped inserts. */
export function buildHasSql({ opinions, ct_links }: Pick<HasMapped, "opinions" | "ct_links">): string[] {
	return [
		`${HAS_OPINIONS_CREATE};`,
		`${HAS_OPINIONS_INDEX};`,
		`${HAS_CT_LINKS_CREATE};`,
		"DELETE FROM has_opinions;",
		"DELETE FROM has_ct_links;",
		...insertStatements("has_opinions", OPINION_COLS, opinions.map((o) => OPINION_COLS.map((c) => o[c]))),
		...insertStatements("has_ct_links", LINK_COLS, ct_links.map((l) => LINK_COLS.map((c) => l[c]))),
	];
}
