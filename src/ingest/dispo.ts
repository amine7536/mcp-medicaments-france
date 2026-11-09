import { decodeCp1252 } from "../lib/cp1252";
import { parseTsv } from "../lib/tsv";
import { DISPO_URL, type Fetcher, get, log } from "./http";

export interface DispoRow {
	cis: string;
	status_code: number;
	status_label: string;
	ansm_path: string;
}

const COLS = 8;
const DISPO_FILE = "CIS_CIP_Dispo_Spec.txt";
const ROWS_PER_INSERT = 25; // 4 columns x 25 rows = 100 bound parameters (limit 100)

/** Decodes and validates `CIS_CIP_Dispo_Spec.txt`; throws on any malformed line or too few rows. */
export function parseDispo(bytes: ArrayBuffer | Uint8Array, minRows = 200): DispoRow[] {
	const rows = parseTsv(decodeCp1252(bytes), COLS, DISPO_FILE, { skipEmptyLines: true }).map((f, i) => {
		const [cis, , code, label, , , , url] = f as [string, string, string, string, string, string, string, string];
		const status_code = Number(code);
		if (cis === "" || code === "" || !Number.isInteger(status_code)) throw new Error(`${DISPO_FILE}: line ${i + 1}: invalid CIS or status code`);
		return {
			cis,
			status_code,
			status_label: label,
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
			"INSERT INTO bdpm_dispo (cis, status_code, status_label, ansm_path) VALUES " + chunk.map(() => "(?, ?, ?, ?)").join(", ");
		stmts.push(db.prepare(sql).bind(...chunk.flatMap((r) => [r.cis, r.status_code, r.status_label, r.ansm_path])));
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
