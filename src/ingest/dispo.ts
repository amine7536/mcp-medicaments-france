import { decodeCp1252 } from "../lib/cp1252";
import { insertChunks } from "../lib/db";
import { parseTsv } from "../lib/tsv";
import { DISPO_URL, errorMessage, type Fetcher, get, log } from "./http";

export interface DispoRow {
	cis: string;
	status_code: number;
	status_label: string;
	ansm_path: string;
}

const COLS = 8;
const DISPO_FILE = "CIS_CIP_Dispo_Spec.txt";

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
	await db.batch([
		db.prepare("DELETE FROM bdpm_dispo"),
		...insertChunks(
			db,
			"bdpm_dispo",
			["cis", "status_code", "status_label", "ansm_path"],
			rows.map((r) => [r.cis, r.status_code, r.status_label, r.ansm_path]),
		),
	]);
}

/** Fetches, validates and stores the BDPM shortage file. On any failure the table is kept. */
export async function ingestDispo(db: D1Database, fetcher: Fetcher, minRows = 200): Promise<"ok" | "failed"> {
	try {
		const res = await get(fetcher, DISPO_URL);
		if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
		await replaceDispo(db, parseDispo(await res.arrayBuffer(), minRows));
		return "ok";
	} catch (err) {
		log("dispo_failed", { reason: errorMessage(err) });
		return "failed";
	}
}
