import { decodeHTML } from "entities/decode";
import * as z from "zod";
import { parseFrDate } from "../../src/lib/dates";
import { normalize } from "../../src/lib/normalize";

export const FILES = {
	cisBdpm: { name: "CIS_bdpm.txt", cols: 12, floor: 12_000 },
	compo: { name: "CIS_COMPO_bdpm.txt", cols: 8, floor: 25_000 },
	mitm: { name: "CIS_MITM.txt", cols: 7, floor: 6_000 },
	presentations: { name: "CIS_CIP_bdpm.txt", cols: 13, floor: 15_000 },
	prescriptionConditions: { name: "CIS_CPD_bdpm.txt", cols: 2, floor: 20_000 },
	safetyInformation: { name: "CIS_InfoImportantes.txt", cols: 4, floor: 5_000 },
} as const;

export interface MedicineRow {
	cis: string;
	denomination: string;
	denomination_norm: string;
	form: string | null;
	routes: string | null;
	amm_status: string | null;
	marketing_status: string | null;
	holder: string | null;
	bdpm_updated_at: string;
}

interface SubstanceRow {
	cis: string;
	substance_name: string;
	substance_norm: string;
	dosage: string | null;
}

/** A substance (SA row) with its reference and the therapeutic fractions (FT rows) linked to it. */
interface CompositionRow {
	cis: string;
	substance_name: string;
	dosage: string | null;
	reference: string | null;
	/** JSON array of `{name, dosage, reference}` in file order; null when no FT row is linked. */
	therapeutic_fractions: string | null;
}

interface MitmRow {
	cis: string;
	atc_code: string;
}

interface FtsRow {
	cis: string;
	denomination_norm: string;
	substances_norm: string;
}

interface PresentationRow {
	cip13: string;
	cip7: string | null;
	cis: string;
	label: string;
	admin_status: string | null;
	marketing_status: string | null;
	declared_at: string | null;
	hospital_approval: 0 | 1 | null;
	/** JSON array of integers, in source order. */
	reimbursement_rates: string | null;
	price_eur: number | null;
	public_price_eur: number | null;
	dispensing_fee_eur: number | null;
	reimbursement_indications: string | null;
}

interface PrescriptionConditionRow {
	cis: string;
	condition: string;
	/** 1-based source order within the CIS. */
	position: number;
}

interface SafetyInformationRow {
	cis: string;
	title: string;
	url: string;
	starts_on: string;
	ends_on: string;
}

interface Skipped {
	medicines: number;
	substances: number;
	mitm: number;
	/** FT rows linked to no stored SA row. */
	fractions: number;
}

export interface Mapped {
	medicines: MedicineRow[];
	substances: SubstanceRow[];
	composition: CompositionRow[];
	mitm: MitmRow[];
	fts: FtsRow[];
	presentations: PresentationRow[];
	prescription_conditions: PrescriptionConditionRow[];
	safety_information: SafetyInformationRow[];
	skipped: Skipped;
}

export interface BdpmInput {
	cisBdpm: string[][];
	compo: string[][];
	mitm: string[][];
	presentations: string[][];
	prescriptionConditions: string[][];
	safetyInformation: string[][];
	bannerDate: string | null;
}

const CIS_RE = /^\d{8}$/;
const CIP13_RE = /^\d{13}$/;
/** A real calendar date in `YYYY-MM-DD`, accepted exactly as the output schema accepts it. */
const ISO_DATE = z.iso.date();
/** The `href` value (single or double quotes) of the cell's leading `<a>`. */
const HREF_RE = /^\s*<a\b[^>]*?\shref=(['"])([^'"]*)\1/i;
/** The inner text of the `<a>` that spans the whole cell; inner texts may hold a literal `>` but no `<`. */
const INNER_RE = /^\s*<a\b[^>]*>(.*)<\/a>\s*$/is;
/** ANSM pages, as published: `http://` or `https://`, with or without `www.`. */
const ANSM_URL_RE = /^https?:\/\/(www\.)?ansm\.sante\.fr\//;
const PRICE_RE = /^\d+(,\d{3})*(,\d{1,2})?$/;
/** Declaration dates go back to 1910. */
const DECLARED_YEARS = { min: 1900, max: 2100 };
const opt = (v: string | undefined): string | null => (v === undefined || v === "" ? null : v);
const req = (v: string | undefined): string => v ?? "";

function validate(rows: string[][], file: (typeof FILES)[keyof typeof FILES]): void {
	if (rows.length < file.floor) {
		throw new Error(`${file.name}: ${rows.length} rows, below the floor of ${file.floor}`);
	}
	rows.forEach((row, i) => {
		if (!CIS_RE.test(req(row[0]))) {
			throw new Error(`${file.name}: line ${i + 1} has invalid CIS "${req(row[0])}", expected 8 digits`);
		}
	});
}

/** A BDPM price: the last comma is the decimal separator, the other commas are dropped (`1,466,29` is 1466.29). Null when empty. Throws on any other format. */
export function parsePrice(v: string): number | null {
	const s = v.trim();
	if (s === "") return null;
	if (!PRICE_RE.test(s)) throw new Error(`${FILES.presentations.name}: invalid price "${s}"`);
	const i = s.lastIndexOf(",");
	return Number(i < 0 ? s : `${s.slice(0, i).replaceAll(",", "")}.${s.slice(i + 1)}`);
}

/** BDPM reimbursement rates (`65%`, `65 %`, `100%;65%`) as a JSON array of integers in source order. Null when empty. */
export function parseRates(v: string): string | null {
	const rates = v.split(";").flatMap((part) => {
		const m = /(\d+)\s*%/.exec(part);
		return m ? [Number(m[1])] : [];
	});
	return rates.length === 0 ? null : JSON.stringify(rates);
}

/** `oui` is 1, `non` is 0, anything else null. */
export function parseApproval(v: string): 0 | 1 | null {
	return v === "oui" ? 1 : v === "non" ? 0 : null;
}

function mapPresentations(rows: string[][]): PresentationRow[] {
	const file = FILES.presentations;
	validate(rows, file);
	rows.forEach((row, i) => {
		if (!CIP13_RE.test(req(row[6]))) {
			throw new Error(`${file.name}: line ${i + 1} has invalid CIP13 "${req(row[6])}", expected 13 digits`);
		}
	});
	return rows.map((r) => ({
		cip13: req(r[6]),
		cip7: opt(r[1]),
		cis: req(r[0]),
		label: req(r[2]),
		admin_status: opt(r[3]),
		marketing_status: opt(r[4]),
		declared_at: parseFrDate(req(r[5]), DECLARED_YEARS),
		hospital_approval: parseApproval(req(r[7])),
		reimbursement_rates: parseRates(req(r[8])),
		price_eur: parsePrice(req(r[9])),
		public_price_eur: parsePrice(req(r[10])),
		dispensing_fee_eur: parsePrice(req(r[11])),
		reimbursement_indications: cleanIndications(opt(r[12])),
	}));
}

/** Verbatim conditions per CIS in source order; a repeated (cis, condition) pair keeps its first position. Throws on an empty condition. */
function mapPrescriptionConditions(rows: string[][]): PrescriptionConditionRow[] {
	const file = FILES.prescriptionConditions;
	validate(rows, file);
	const seen = new Map<string, Set<string>>();
	const out: PrescriptionConditionRow[] = [];
	rows.forEach((row, i) => {
		const cis = req(row[0]);
		const condition = req(row[1]);
		if (condition === "") throw new Error(`${file.name}: line ${i + 1} has an empty condition, expected a non-empty value`);
		let conditions = seen.get(cis);
		if (!conditions) seen.set(cis, (conditions = new Set()));
		if (conditions.has(condition)) return;
		conditions.add(condition);
		out.push({ cis, condition, position: conditions.size });
	});
	return out;
}

/** Reimbursement indications with each `<br>` (any case, `<br/>`, `<br />`) as a newline, trimmed; null when nothing is left. */
export function cleanIndications(v: string | null): string | null {
	if (v === null) return null;
	const text = v.replace(/<br\s*\/?>/gi, "\n").trim();
	return text === "" ? null : text;
}

/** Title and URL of the ANSM page linked by an anchor cell; null when the cell has no `<a>` with an `href`. */
export function parseAnchor(cell: string): { title: string; url: string } | null {
	const href = HREF_RE.exec(cell);
	const inner = INNER_RE.exec(cell);
	if (!href || !inner) return null;
	return { url: href[2] as string, title: decodeHTML((inner[1] as string).replace(/<[^>]*>/g, "")).trim() };
}

/** Columns: CIS, start date, end date (ISO), HTML anchor to the ANSM page. Throws on any invalid row. */
function mapSafetyInformation(rows: string[][]): SafetyInformationRow[] {
	const file = FILES.safetyInformation;
	validate(rows, file);
	return rows.map((row, i) => {
		const line = `${file.name}: line ${i + 1}`;
		const [starts_on, ends_on] = [req(row[1]), req(row[2])];
		if (!ISO_DATE.safeParse(starts_on).success) throw new Error(`${line} has invalid start date "${starts_on}", expected YYYY-MM-DD`);
		if (!ISO_DATE.safeParse(ends_on).success) throw new Error(`${line} has invalid end date "${ends_on}", expected YYYY-MM-DD`);
		const anchor = parseAnchor(req(row[3]));
		if (anchor === null) throw new Error(`${line} has no anchor with an href`);
		if (!ANSM_URL_RE.test(anchor.url)) throw new Error(`${line} has a non-ANSM URL "${anchor.url}"`);
		if (anchor.title === "") throw new Error(`${line} has an empty title, expected a non-empty value`);
		return { cis: req(row[0]), title: anchor.title, url: anchor.url, starts_on, ends_on };
	});
}

/** Composition nature: active substance or therapeutic fraction. */
const NATURES = new Set(["SA", "FT"]);

/** An FT row links to the SA rows of the same CIS, element designation and link number. */
const fractionKey = (r: string[]): string => `${req(r[0])}\t${req(r[1])}\t${req(r[7])}`;

/**
 * One row per SA row with a non-empty name, in file order, with the FT rows of the same CIS, element and link number
 * (in file order, wherever they sit in the file). FT rows linked to no stored SA row are counted, not stored.
 */
function mapComposition(rows: string[][]): { composition: CompositionRow[]; unattached: number } {
	const fractions = new Map<string, Array<{ name: string; dosage: string | null; reference: string | null }>>();
	for (const r of rows) {
		if (r[6] !== "FT") continue;
		const key = fractionKey(r);
		let list = fractions.get(key);
		if (!list) fractions.set(key, (list = []));
		list.push({ name: req(r[3]), dosage: opt(r[4]), reference: opt(r[5]) });
	}
	const attached = new Set<string>();
	const composition: CompositionRow[] = [];
	for (const r of rows) {
		const name = req(r[3]);
		if (r[6] !== "SA" || name === "") continue;
		const key = fractionKey(r);
		const linked = fractions.get(key);
		if (linked) attached.add(key);
		composition.push({ cis: req(r[0]), substance_name: name, dosage: opt(r[4]), reference: opt(r[5]), therapeutic_fractions: linked ? JSON.stringify(linked) : null });
	}
	let unattached = 0;
	for (const [key, list] of fractions) if (!attached.has(key)) unattached += list.length;
	return { composition, unattached };
}

/** Validates the parsed BDPM files and maps them to table rows. Throws on any validation failure. */
export function validateAndMap({ cisBdpm, compo, mitm, presentations, prescriptionConditions, safetyInformation, bannerDate }: BdpmInput): Mapped {
	validate(cisBdpm, FILES.cisBdpm);
	validate(compo, FILES.compo);
	validate(mitm, FILES.mitm);
	const presentationRows = mapPresentations(presentations);
	const conditionRows = mapPrescriptionConditions(prescriptionConditions);
	const safetyRows = mapSafetyInformation(safetyInformation);
	mitm.forEach((row, i) => {
		if (req(row[1]) === "") throw new Error(`${FILES.mitm.name}: line ${i + 1} has an empty ATC, expected a non-empty value`);
	});
	compo.forEach((row, i) => {
		const nature = req(row[6]);
		if (!NATURES.has(nature)) throw new Error(`${FILES.compo.name}: line ${i + 1} has nature "${nature}", expected SA or FT`);
	});
	if (bannerDate === null) throw new Error("telechargement: release date banner not found or invalid");

	const { composition, unattached } = mapComposition(compo);
	const skipped: Skipped = { medicines: 0, substances: 0, mitm: 0, fractions: unattached };

	const medicines: MedicineRow[] = [];
	for (const r of cisBdpm) {
		const denomination = req(r[1]);
		if (denomination === "") {
			skipped.medicines++;
			continue;
		}
		medicines.push({
			cis: req(r[0]),
			denomination,
			denomination_norm: normalize(denomination),
			form: opt(r[2]),
			routes: opt(r[3]),
			amm_status: opt(r[4]),
			marketing_status: opt(r[6]),
			holder: opt(r[10]),
			bdpm_updated_at: bannerDate,
		});
	}
	const known = new Set(medicines.map((m) => m.cis));

	const substances: SubstanceRow[] = [];
	for (const r of compo) {
		if (r[6] !== "SA") continue;
		const name = req(r[3]);
		if (name === "") {
			skipped.substances++;
			continue;
		}
		substances.push({
			cis: req(r[0]),
			substance_name: name,
			substance_norm: normalize(name),
			dosage: opt(r[4]),
		});
	}

	const mitmRows: MitmRow[] = [];
	for (const r of mitm) {
		const cis = req(r[0]);
		const atc = req(r[1]);
		if (!known.has(cis)) {
			skipped.mitm++;
			continue;
		}
		mitmRows.push({ cis, atc_code: atc });
	}

	const byCis = new Map<string, Set<string>>();
	for (const s of substances) {
		let set = byCis.get(s.cis);
		if (!set) byCis.set(s.cis, (set = new Set()));
		set.add(s.substance_norm);
	}
	const fts: FtsRow[] = medicines.map((m) => ({
		cis: m.cis,
		denomination_norm: m.denomination_norm,
		substances_norm: [...(byCis.get(m.cis) ?? [])].sort().join(" "),
	}));

	return { medicines, substances, composition, mitm: mitmRows, fts, presentations: presentationRows, prescription_conditions: conditionRows, safety_information: safetyRows, skipped };
}
