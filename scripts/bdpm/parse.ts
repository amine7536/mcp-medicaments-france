import { parseFrDate } from "../../src/lib/dates";
import { decodeEntities } from "../../src/lib/normalize";

export { decodeCp1252 } from "../../src/lib/cp1252";

/** Splits headerless, unquoted TSV into trimmed fields; every line must have `expectedCols` columns. */
export function parseTsv(text: string, expectedCols: number, fileName: string): string[][] {
	const lines = text.split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	return lines.map((line, i) => {
		const fields = line.split("\t");
		if (fields.length !== expectedCols) {
			throw new Error(`${fileName}: line ${i + 1} has ${fields.length} columns, expected ${expectedCols}`);
		}
		return fields.map((f) => f.trim());
	});
}

/** Extracts the release date (`Dernière mise à jour le DD/MM/YYYY`) of the download page as ISO, or null. */
export function parseBanner(html: string): string | null {
	const m = /Dernière mise à jour le\s+(\d{1,2}\/\d{1,2}\/\d{4})/.exec(decodeEntities(html));
	return m ? parseFrDate(m[1] as string) : null;
}
