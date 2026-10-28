import { env } from "cloudflare:workers";
import { normalize } from "../src/lib/normalize";
import { resetDb } from "./db";

/** The instant the seeded data is read at. */
export const NOW = new Date("2026-10-27T12:00:00.000Z");
export const ANSM_LAST_INGEST = "2026-10-27T05:10:00.000Z";
export const BDPM_RELEASE = "2026-10-05";

interface Med {
	cis: string;
	name: string;
	form: string;
	substances: Array<[string, string]>;
	atc?: string;
}

export const MEDICINES = {
	/** In rupture (match 1.0, month-precision return) and in tension (second entry); MITM. */
	dolipraneTablet: { cis: "60000001", name: "DOLIPRANE 1000 mg, comprimé", form: "comprimé", substances: [["PARACÉTAMOL", "1000 mg"]], atc: "N02BE01" },
	/** No linked shortage; an unmatched DOLIPRANE entry is listed. */
	dolipraneCapsule: { cis: "60000002", name: "DOLIPRANE 500 mg, gélule", form: "gélule", substances: [["PARACÉTAMOL", "500 mg"]] },
	/** In tension through a probable match (0.6), announced return passed; hospital only. */
	amoxicilline: {
		cis: "60000003",
		name: "AMOXICILLINE BIOGARAN 500 mg, gélule",
		form: "gélule",
		substances: [["AMOXICILLINE", "500 mg"]],
		atc: "J01CA04",
	},
	/** No shortage and no related entry. */
	kardegic: { cis: "60000004", name: "KARDEGIC 75 mg, poudre pour solution buvable en sachet", form: "poudre", substances: [["ACÉTYLSALICYLATE DE LYSINE", "75 mg"]] },
	/** Commercialisation stopped (city). */
	zymad: { cis: "60000005", name: "ZYMAD 80 000 UI, solution buvable en ampoule", form: "solution buvable", substances: [["CHOLÉCALCIFÉROL", "80 000 UI"]] },
} satisfies Record<string, Med>;

interface Presentation {
	cip13: string;
	cis: string;
	label: string;
	marketing_status: string;
	public_price_eur: number | null;
	reimbursement_rates: string | null;
}

const MARKETED = "Déclaration de commercialisation";

export const PRESENTATIONS = {
	/** DOLIPRANE 1000 mg: two marketed boxes and one stopped; the default order is boxOf8, boxOf100, stopped. */
	dolipraneBoxOf8: {
		cip13: "3400930000011",
		cis: "60000001",
		label: "plaquette(s) PVC aluminium de 8 comprimé(s)",
		marketing_status: MARKETED,
		public_price_eur: 2.18,
		reimbursement_rates: "[65]",
	},
	dolipraneBoxOf100: {
		cip13: "3400930000028",
		cis: "60000001",
		label: "plaquette(s) PVC aluminium de 100 comprimé(s)",
		marketing_status: MARKETED,
		public_price_eur: null,
		reimbursement_rates: null,
	},
	dolipraneStopped: {
		cip13: "3400930000035",
		cis: "60000001",
		label: "flacon de 8 comprimé(s)",
		marketing_status: "Déclaration d'arrêt de commercialisation",
		public_price_eur: 1.5,
		reimbursement_rates: "[100,65]",
	},
	...Object.fromEntries(
		Array.from({ length: 12 }, (_, i) => [
			`kardegic${i}`,
			{
				cip13: String(3_400_940_000_000 + i),
				cis: "60000004",
				label: `sachet(s) papier aluminium de ${String(i + 10)} sachet(s)`,
				marketing_status: MARKETED,
				public_price_eur: 3,
				reimbursement_rates: "[65]",
			},
		]),
	),
} satisfies Record<string, Presentation>;

interface Shortage {
	id: string;
	name: string;
	status: string;
	status_raw: string;
	scope: string;
	scope_raw: string | null;
	updated: string;
	er?: { earliest: string; latest: string; precision: string; part?: string; raw: string };
	areas?: string;
	situation_start?: string;
	returned_at?: string;
	first_seen_at?: string;
	listed?: 0 | 1;
	dci?: string;
}

export const MONTH_RAW = "Remise à disposition prévue courant novembre 2026";
export const PASSED_RAW = "Remise à disposition prévue le 01/10/2026";

export const SHORTAGES = {
	dolipraneRupture: {
		id: "1001",
		name: "DOLIPRANE 1000 mg, comprimé",
		dci: "paracétamol",
		status: "rupture",
		status_raw: "Rupture de stock",
		scope: "ville",
		scope_raw: "Ville",
		updated: "2026-10-22",
		er: { earliest: "2026-11-01", latest: "2026-11-30", precision: "month", raw: MONTH_RAW },
		areas: "Antalgie",
		first_seen_at: "2026-10-01T05:00:00.000Z",
	},
	dolipraneTension: {
		id: "1006",
		name: "DOLIPRANE 1000 mg, comprimé (boîte de 100)",
		status: "tension",
		status_raw: "Tension d'approvisionnement",
		scope: "ville",
		scope_raw: "Ville",
		updated: "2026-10-26",
	},
	amoxicilline: {
		id: "1002",
		name: "AMOXICILLINE BIOGARAN 500 mg, gélule",
		status: "tension",
		status_raw: "Tension d'approvisionnement",
		scope: "hopital",
		scope_raw: "Hôpital",
		updated: "2026-10-25",
		er: { earliest: "2026-10-01", latest: "2026-10-01", precision: "day", raw: PASSED_RAW },
		areas: "Infectiologie",
		situation_start: "2026-09-15",
		first_seen_at: "2026-10-25T05:00:00.000Z",
	},
	zymad: {
		id: "1003",
		name: "ZYMAD 80 000 UI, solution buvable en ampoule",
		status: "arret_commercialisation",
		status_raw: "Arrêt de commercialisation",
		scope: "ville",
		scope_raw: "Ville",
		updated: "2026-10-10",
		areas: "Rhumatologie",
	},
	remise: {
		id: "1004",
		name: "SPASFON 80 mg, comprimé",
		status: "remise_a_disposition",
		status_raw: "Remise à disposition",
		scope: "ville_hopital",
		scope_raw: "Ville et Hôpital",
		updated: "2026-10-20",
		returned_at: "2026-10-19",
		areas: "Gastro-entérologie",
	},
	/** Unmatched, listed, shares the DOLIPRANE brand token. */
	dolipraneUnmatched: {
		id: "1005",
		name: "DOLIPRANE 500 mg, suppositoire",
		status: "tension",
		status_raw: "Tension d'approvisionnement",
		scope: "ville",
		scope_raw: "Ville",
		updated: "2026-10-24",
	},
	autre: {
		id: "1007",
		name: "PRODUIT X 1 mg, solution",
		status: "autre",
		status_raw: "Autre",
		scope: "inconnu",
		scope_raw: null,
		updated: "2026-10-15",
	},
	/** Delisted: never in lists. */
	delisted: {
		id: "1008",
		name: "KARDEGIC 160 mg, poudre",
		status: "rupture",
		status_raw: "Rupture de stock",
		scope: "ville",
		scope_raw: "Ville",
		updated: "2026-09-01",
		listed: 0,
	},
} satisfies Record<string, Shortage>;

const MATCHES: Array<[shortage: string, cis: string, confidence: number]> = [
	["1001", "60000001", 1],
	["1006", "60000001", 1],
	["1002", "60000003", 0.6],
	["1003", "60000005", 1],
];

const HISTORY: Array<[shortage: string, type: string, old_status: string | null, new_status: string | null, old_er: string | null, new_er: string | null, at: string]> = [
	["1001", "new", null, "tension", null, null, "2026-10-01T05:00:00.000Z"],
	["1001", "status_change", "tension", "rupture", null, null, "2026-10-20T05:00:00.000Z"],
	["1001", "return_date_change", null, null, "Remise à disposition prévue fin octobre 2026", MONTH_RAW, "2026-10-22T05:00:00.000Z"],
	["1002", "new", null, "tension", null, null, "2026-10-25T05:00:00.000Z"],
	["1008", "delisted", null, null, null, null, "2026-10-26T05:00:00.000Z"],
	["1003", "new", null, "arret_commercialisation", null, null, "2026-09-10T05:00:00.000Z"],
];

/** Empties every table, then inserts the fixture medicines, shortages, matches, history and ingest runs. */
export async function seed(): Promise<void> {
	await resetDb();
	const db = env.DB;
	const stmts: D1PreparedStatement[] = ["substances", "mitm", "medicines_fts", "presentations"].map((t) => db.prepare(`DELETE FROM ${t}`));
	for (const m of Object.values(MEDICINES) as Med[]) {
		stmts.push(
			db
				.prepare("INSERT INTO medicines (cis, denomination, denomination_norm, form, bdpm_updated_at) VALUES (?, ?, ?, ?, ?)")
				.bind(m.cis, m.name, normalize(m.name), m.form, BDPM_RELEASE),
		);
		for (const [name, dosage] of m.substances) {
			stmts.push(
				db
					.prepare("INSERT INTO substances (cis, substance_name, substance_norm, dosage, nature) VALUES (?, ?, ?, ?, 'SA')")
					.bind(m.cis, name, normalize(name), dosage),
			);
		}
		if (m.atc) stmts.push(db.prepare("INSERT INTO mitm (cis, atc_code) VALUES (?, ?)").bind(m.cis, m.atc));
		stmts.push(
			db
				.prepare("INSERT INTO medicines_fts (cis, denomination_norm, substances_norm) VALUES (?, ?, ?)")
				.bind(m.cis, normalize(m.name), m.substances.map(([n]) => normalize(n)).join(" ")),
		);
	}
	for (const p of Object.values(PRESENTATIONS) as Presentation[]) {
		stmts.push(
			db
				.prepare(
					"INSERT INTO presentations (cip13, cip7, cis, label, admin_status, marketing_status, declared_at, hospital_approval, reimbursement_rates, public_price_eur) VALUES (?, ?, ?, ?, 'Présentation active', ?, '2011-03-16', 1, ?, ?)",
				)
				.bind(p.cip13, p.cip13.slice(5, 12), p.cis, p.label, p.marketing_status, p.reimbursement_rates, p.public_price_eur),
		);
	}
	for (const s of Object.values(SHORTAGES) as Shortage[]) {
		stmts.push(
			db
				.prepare(
					`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, dci_raw, status, status_raw, scope, scope_raw,
						expected_return_earliest, expected_return_latest, expected_return_precision, expected_return_part, expected_return_raw,
						returned_at, situation_start, therapeutic_areas, therapeutic_areas_norm, ansm_updated_at, list_hash, first_seen_at, last_seen_at, listed)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'h', ?, ?, ?)`,
				)
				.bind(
					s.id,
					`/disponibilites-des-produits-de-sante/medicaments/entry-${s.id}`,
					s.name,
					normalize(s.name),
					s.dci ?? null,
					s.status,
					s.status_raw,
					s.scope,
					s.scope_raw,
					s.er?.earliest ?? null,
					s.er?.latest ?? null,
					s.er?.precision ?? null,
					s.er?.part ?? null,
					s.er?.raw ?? null,
					s.returned_at ?? null,
					s.situation_start ?? null,
					s.areas ?? null,
					s.areas ? normalize(s.areas) : null,
					s.updated,
					s.first_seen_at ?? "2026-09-01T05:00:00.000Z",
					ANSM_LAST_INGEST,
					s.listed ?? 1,
				),
		);
	}
	for (const [shortage, cis, confidence] of MATCHES) {
		stmts.push(
			db
				.prepare("INSERT INTO shortage_matches (shortage_id, cis, method, confidence, is_best) VALUES (?, ?, 'exact', ?, 1)")
				.bind(shortage, cis, confidence),
		);
	}
	for (const [shortage, type, oldStatus, newStatus, oldEr, newEr, at] of HISTORY) {
		stmts.push(
			db
				.prepare(
					"INSERT INTO status_history (shortage_id, change_type, old_status, new_status, old_expected_return, new_expected_return, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				)
				.bind(shortage, type, oldStatus, newStatus, oldEr, newEr, at),
		);
	}
	stmts.push(
		db
			.prepare("INSERT INTO ingest_runs (source, started_at, finished_at, status) VALUES ('ansm', ?, ?, 'ok')")
			.bind("2026-10-27T05:00:00.000Z", ANSM_LAST_INGEST),
		db
			.prepare("INSERT INTO ingest_runs (source, started_at, finished_at, status, bdpm_release) VALUES ('bdpm', ?, ?, 'ok', ?)")
			.bind("2026-10-05T06:00:00.000Z", "2026-10-05T06:10:00.000Z", BDPM_RELEASE),
	);
	await db.batch(stmts);
}
