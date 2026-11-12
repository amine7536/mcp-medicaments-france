import type { Mapped } from "./map";

const encoder = new TextEncoder();
const byteLength = (s: string): number => encoder.encode(s).length;

type Value = string | number | null;

/** SQL literal: NULL, a number, or a single-quoted string with quotes doubled. */
export function sqlLiteral(v: Value): string {
	if (v === null) return "NULL";
	if (typeof v === "number") {
		if (!Number.isFinite(v)) throw new Error(`not a finite number: ${v}`);
		return String(v);
	}
	return `'${v.replaceAll("'", "''")}'`;
}

/** Multi-row INSERT statements, each at most `maxBytes` of UTF-8. */
export function insertStatements(
	table: string,
	cols: readonly string[],
	rows: ReadonlyArray<ReadonlyArray<Value>>,
	maxBytes = 90_000,
): string[] {
	const head = `INSERT INTO ${table} (${cols.join(", ")}) VALUES `;
	const headBytes = byteLength(head);
	const statements: string[] = [];
	let tuples: string[] = [];
	let size = headBytes;

	for (const row of rows) {
		const tuple = `(${row.map(sqlLiteral).join(",")})`;
		const tupleBytes = byteLength(tuple);
		if (headBytes + tupleBytes + 1 > maxBytes) {
			throw new Error(`${table}: a single row exceeds ${maxBytes} bytes`);
		}
		// +1 for the separating comma or the final semicolon.
		if (tuples.length > 0 && size + tupleBytes + 1 > maxBytes) {
			statements.push(`${head}${tuples.join(",")};`);
			tuples = [];
			size = headBytes;
		}
		tuples.push(tuple);
		size += tupleBytes + 1;
	}
	if (tuples.length > 0) statements.push(`${head}${tuples.join(",")};`);
	return statements;
}

const COLS = {
	medicines: ["cis", "denomination", "denomination_norm", "form", "routes", "amm_status", "marketing_status", "holder", "bdpm_updated_at"],
	substances: ["cis", "substance_name", "substance_norm", "dosage"],
	composition: ["cis", "substance_name", "dosage", "reference", "therapeutic_fractions"],
	mitm: ["cis", "atc_code"],
	medicines_fts: ["cis", "denomination_norm", "substances_norm"],
	presentations: [
		"cip13",
		"cip7",
		"cis",
		"label",
		"admin_status",
		"marketing_status",
		"declared_at",
		"hospital_approval",
		"reimbursement_rates",
		"price_eur",
		"public_price_eur",
		"dispensing_fee_eur",
		"reimbursement_indications",
	],
	prescription_conditions: ["cis", "condition", "position"],
	safety_information: ["cis", "title", "url", "starts_on", "ends_on"],
} as const;

function values<T extends object>(rows: readonly T[], cols: readonly (keyof T & string)[]): Value[][] {
	return rows.map((r) => cols.map((c) => r[c] as Value));
}

interface ImportSqlInput extends Mapped {
	release: string;
	startedAt: string;
	finishedAt: string;
}

/** Creates the trigram index when missing (same statement as migration 0006), so the import works before or after that migration. */
export const TRGM_CREATE =
	"CREATE VIRTUAL TABLE IF NOT EXISTS medicines_trgm USING fts5(cis UNINDEXED, denomination_norm, substances_norm, tokenize='trigram')";
/** Refills the trigram index from the full-text rows just inserted. */
export const TRGM_FILL =
	"INSERT INTO medicines_trgm (cis, denomination_norm, substances_norm) SELECT cis, denomination_norm, substances_norm FROM medicines_fts";

/** Creates the composition table when missing (same statement as migration 0013), so the import works before or after that migration. */
export const COMPOSITION_CREATE =
	"CREATE TABLE IF NOT EXISTS composition (cis TEXT NOT NULL, substance_name TEXT NOT NULL, dosage TEXT, reference TEXT, therapeutic_fractions TEXT)";
/** Index of the composition table (same statement as migration 0013). */
export const COMPOSITION_INDEX = "CREATE INDEX IF NOT EXISTS idx_composition_cis ON composition (cis)";

/** Full import file: creates the trigram index and the composition table if missing, deletes, size-capped inserts, refills the trigram index, then the ingest_runs row. No BEGIN/COMMIT. */
export function buildImportSql(input: ImportSqlInput): string {
	const { medicines, substances, composition, mitm, fts, presentations, prescription_conditions, safety_information, skipped, release, startedAt, finishedAt } = input;
	const skippedTotal = skipped.medicines + skipped.substances + skipped.mitm + skipped.fractions;
	const message = `medicines=${medicines.length} substances=${substances.length} composition=${composition.length} mitm=${mitm.length} presentations=${presentations.length} prescription_conditions=${prescription_conditions.length} safety_information=${safety_information.length} skipped=${skippedTotal}`;
	const statements = [
		`${TRGM_CREATE};`,
		`${COMPOSITION_CREATE};`,
		`${COMPOSITION_INDEX};`,
		"DELETE FROM medicines_fts;",
		"DELETE FROM medicines_trgm;",
		"DELETE FROM mitm;",
		"DELETE FROM substances;",
		"DELETE FROM composition;",
		"DELETE FROM medicines;",
		"DELETE FROM presentations;",
		"DELETE FROM prescription_conditions;",
		"DELETE FROM safety_information;",
		...insertStatements("medicines", COLS.medicines, values(medicines, COLS.medicines)),
		...insertStatements("substances", COLS.substances, values(substances, COLS.substances)),
		...insertStatements("composition", COLS.composition, values(composition, COLS.composition)),
		...insertStatements("mitm", COLS.mitm, values(mitm, COLS.mitm)),
		...insertStatements("medicines_fts", COLS.medicines_fts, values(fts, COLS.medicines_fts)),
		`${TRGM_FILL};`,
		...insertStatements("presentations", COLS.presentations, values(presentations, COLS.presentations)),
		...insertStatements("prescription_conditions", COLS.prescription_conditions, values(prescription_conditions, COLS.prescription_conditions)),
		...insertStatements("safety_information", COLS.safety_information, values(safety_information, COLS.safety_information)),
		"INSERT INTO ingest_runs (source, started_at, finished_at, status, entries_seen, bdpm_release, message) VALUES " +
			`('bdpm', ${sqlLiteral(startedAt)}, ${sqlLiteral(finishedAt)}, 'ok', ${medicines.length}, ${sqlLiteral(release)}, ${sqlLiteral(message)});`,
	];
	return `${statements.join("\n")}\n`;
}
