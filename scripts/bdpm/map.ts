import { normalize } from "../../src/lib/normalize";

export const FILES = {
	cisBdpm: { name: "CIS_bdpm.txt", cols: 12, floor: 12_000 },
	compo: { name: "CIS_COMPO_bdpm.txt", cols: 8, floor: 25_000 },
	mitm: { name: "CIS_MITM.txt", cols: 7, floor: 6_000 },
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
	skipped: Skipped;
}

export interface BdpmInput {
	cisBdpm: string[][];
	compo: string[][];
	mitm: string[][];
	bannerDate: string | null;
}

const CIS_RE = /^\d{8}$/;
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

/** Validates the parsed BDPM files and maps them to table rows. Throws on any validation failure. */
export function validateAndMap({ cisBdpm, compo, mitm, bannerDate }: BdpmInput): Mapped {
	validate(cisBdpm, FILES.cisBdpm);
	validate(compo, FILES.compo);
	validate(mitm, FILES.mitm);
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

	return { medicines, substances, mitm: mitmRows, fts, skipped };
}
