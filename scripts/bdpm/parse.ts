import { parseFrDate } from "../../src/lib/dates";
import { decodeEntities } from "../../src/lib/normalize";

export { decodeCp1252 } from "../../src/lib/cp1252";
export { parseTsv } from "../../src/lib/tsv";

/** Decodes UTF-8 bytes (the presentations file); throws on invalid UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string {
	return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}

/** Extracts the release date (`Dernière mise à jour le DD/MM/YYYY`) of the download page as ISO, or null. */
export function parseBanner(html: string): string | null {
	const m = /Dernière mise à jour le\s+(\d{1,2}\/\d{1,2}\/\d{4})/.exec(decodeEntities(html));
	return m ? parseFrDate(m[1] as string) : null;
}
