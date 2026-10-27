import { decodeCp1252 } from "../lib/cp1252";
import { parseFrDate } from "../lib/dates";
import { DISPO_URL, type Fetcher, get, log } from "./http";

export interface DispoRow {
	cis: string;
	cip13: string | null;
	status_code: number;
	status_label: string;
	date_debut: string | null;
	date_maj: string | null;
	date_remise: string | null;
	ansm_path: string;
}

const COLS = 8;
const ROWS_PER_INSERT = 12; // 8 columns x 12 rows = 96 bound parameters (limit 100)

const date = (s: string): string | null => (s === "" ? null : parseFrDate(s));

/** Decodes and validates `CIS_CIP_Dispo_Spec.txt`; throws on any malformed line or too few rows. */
export function parseDispo(bytes: ArrayBuffer | Uint8Array, minRows = 200): DispoRow[] {
	const lines = decodeCp1252(bytes)
		.split(/\r?\n/)
		.filter((line) => line !== "");
	const rows = lines.map((line, i) => {
		const f = line.split("\t").map((v) => v.trim());
		if (f.length !== COLS) throw new Error(`line ${i + 1} has ${f.length} columns, expected ${COLS}`);
		const [cis, cip13, code, label, debut, maj, remise, url] = f as [string, string, string, string, string, string, string, string];
		const status_code = Number(code);
		if (cis === "" || code === "" || !Number.isInteger(status_code)) throw new Error(`line ${i + 1}: invalid CIS or status code`);
		return {
			cis,
			cip13: cip13 === "" ? null : cip13,
			status_code,
			status_label: label,
			date_debut: date(debut),
			date_maj: date(maj),
			date_remise: date(remise),
			ansm_path: new URL(url).pathname.replace(/\/$/, ""),
		};
	});
	if (rows.length < minRows) throw new Error(`${rows.length} rows, expected at least ${minRows}`);
	return rows;
}

/** Atomically replaces `bdpm_dispo` with `rows` (one batch). */
export async function replaceDispo(db: D1Database, rows: DispoRow[]): Promise<void> {
	const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM bdpm_dispo")];
	for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
		const chunk = rows.slice(i, i + ROWS_PER_INSERT);
		const sql =
			"INSERT INTO bdpm_dispo (cis, cip13, status_code, status_label, date_debut, date_maj, date_remise, ansm_path) VALUES " +
			chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
		stmts.push(
			db
				.prepare(sql)
				.bind(...chunk.flatMap((r) => [r.cis, r.cip13, r.status_code, r.status_label, r.date_debut, r.date_maj, r.date_remise, r.ansm_path])),
		);
	}
	await db.batch(stmts);
}

/** Fetches, validates and stores the BDPM shortage file. On any failure the table is kept. */
export async function ingestDispo(db: D1Database, fetcher: Fetcher, minRows = 200): Promise<"ok" | "failed"> {
	try {
		const res = await get(fetcher, DISPO_URL);
		if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
		await replaceDispo(db, parseDispo(await res.arrayBuffer(), minRows));
		return "ok";
	} catch (err) {
		log("dispo_failed", { reason: err instanceof Error ? err.message : String(err) });
		return "failed";
	}
}
