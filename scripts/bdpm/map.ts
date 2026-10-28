import { parseFrDate } from "../../src/lib/dates";
import { normalize } from "../../src/lib/normalize";

export const FILES = {
	cisBdpm: { name: "CIS_bdpm.txt", cols: 12, floor: 12_000 },
	compo: { name: "CIS_COMPO_bdpm.txt", cols: 8, floor: 25_000 },
	mitm: { name: "CIS_MITM.txt", cols: 7, floor: 6_000 },
	presentations: { name: "CIS_CIP_bdpm.txt", cols: 13, floor: 15_000 },
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

export interface SubstanceRow {
	cis: string;
	substance_code: string | null;
	substance_name: string;
	substance_norm: string;
	dosage: string | null;
	nature: string | null;
}

export interface MitmRow {
	cis: string;
	atc_code: string;
}

export interface FtsRow {
	cis: string;
	denomination_norm: string;
	substances_norm: string;
}

export interface PresentationRow {
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

export interface Skipped {
	medicines: number;
	substances: number;
	mitm: number;
}

export interface Mapped {
	medicines: MedicineRow[];
	substances: SubstanceRow[];
	mitm: MitmRow[];
	fts: FtsRow[];
	presentations: PresentationRow[];
	skipped: Skipped;
}

export interface BdpmInput {
	cisBdpm: string[][];
	compo: string[][];
	mitm: string[][];
	presentations: string[][];
	bannerDate: string | null;
}

const CIS_RE = /^\d{8}$/;
const CIP13_RE = /^\d{13}$/;
const PRICE_RE = /^\d+(,\d{3})*(,\d{1,2})?$/;
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
		declared_at: parseFrDate(req(r[5])),
		hospital_approval: parseApproval(req(r[7])),
		reimbursement_rates: parseRates(req(r[8])),
		price_eur: parsePrice(req(r[9])),
		public_price_eur: parsePrice(req(r[10])),
		dispensing_fee_eur: parsePrice(req(r[11])),
		reimbursement_indications: opt(r[12]),
	}));
}

/** Validates the parsed BDPM files and maps them to table rows. Throws on any validation failure. */
export function validateAndMap({ cisBdpm, compo, mitm, presentations, bannerDate }: BdpmInput): Mapped {
	validate(cisBdpm, FILES.cisBdpm);
	validate(compo, FILES.compo);
	validate(mitm, FILES.mitm);
	const presentationRows = mapPresentations(presentations);
	mitm.forEach((row, i) => {
		if (req(row[1]) === "") throw new Error(`${FILES.mitm.name}: line ${i + 1} has an empty ATC, expected a non-empty value`);
	});
	if (bannerDate === null) throw new Error("telechargement: release date banner not found or invalid");

	const skipped: Skipped = { medicines: 0, substances: 0, mitm: 0 };

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
			substance_code: opt(r[2]),
			substance_name: name,
			substance_norm: normalize(name),
			dosage: opt(r[4]),
			nature: opt(r[6]),
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

	return { medicines, substances, mitm: mitmRows, fts, presentations: presentationRows, skipped };
}
