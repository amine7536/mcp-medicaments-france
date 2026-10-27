export interface TsvOptions {
	/** Drop every empty line instead of only a trailing one; line numbers then count the kept lines. */
	skipEmptyLines?: boolean;
}

/** Splits headerless, unquoted TSV into trimmed fields; every line must have `expectedCols` columns. */
export function parseTsv(text: string, expectedCols: number, fileName: string, opts: TsvOptions = {}): string[][] {
	let lines = text.split(/\r?\n/);
	if (opts.skipEmptyLines) lines = lines.filter((line) => line !== "");
	else if (lines.at(-1) === "") lines.pop();
	return lines.map((line, i) => {
		const fields = line.split("\t");
		if (fields.length !== expectedCols) {
			throw new Error(`${fileName}: line ${i + 1} has ${fields.length} columns, expected ${expectedCols}`);
		}
		return fields.map((f) => f.trim());
	});
}
