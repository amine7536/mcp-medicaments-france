import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FILES, validateAndMap } from "./bdpm/map";
import { decodeCp1252, parseBanner, parseTsv } from "./bdpm/parse";
import { buildImportSql } from "./bdpm/sql";
import { USER_AGENT } from "../src/ingest/http";

const BASE = "https://base-donnees-publique.medicaments.gouv.fr";
const OUT_DIR = ".bdpm";
const SQL_PATH = join(OUT_DIR, "bdpm.sql");

async function download(url: string, fileName: string): Promise<Uint8Array> {
	const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
	if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	await writeFile(join(OUT_DIR, fileName), bytes);
	return bytes;
}

async function main(): Promise<void> {
	const startedAt = new Date().toISOString();
	await mkdir(OUT_DIR, { recursive: true });
	await rm(SQL_PATH, { force: true });

	const cisBdpmBytes = await download(`${BASE}/download/file/${FILES.cisBdpm.name}`, FILES.cisBdpm.name);
	const compoBytes = await download(`${BASE}/download/file/${FILES.compo.name}`, FILES.compo.name);
	const mitmBytes = await download(`${BASE}/download/file/${FILES.mitm.name}`, FILES.mitm.name);
	const pageBytes = await download(`${BASE}/telechargement`, "telechargement.html");

	const bannerDate = parseBanner(new TextDecoder().decode(pageBytes));
	const mapped = validateAndMap({
		cisBdpm: parseTsv(decodeCp1252(cisBdpmBytes), FILES.cisBdpm.cols, FILES.cisBdpm.name),
		compo: parseTsv(decodeCp1252(compoBytes), FILES.compo.cols, FILES.compo.name),
		mitm: parseTsv(decodeCp1252(mitmBytes), FILES.mitm.cols, FILES.mitm.name),
		bannerDate,
	});
	// validateAndMap throws when the banner date is missing.
	const release = bannerDate as string;

	const sql = buildImportSql({ ...mapped, release, startedAt, finishedAt: new Date().toISOString() });
	await writeFile(SQL_PATH, sql);

	const { skipped } = mapped;
	console.log(`BDPM release ${release}`);
	console.log(
		`medicines=${mapped.medicines.length} substances=${mapped.substances.length} mitm=${mapped.mitm.length} fts=${mapped.fts.length}`,
	);
	console.log(`skipped medicines=${skipped.medicines} substances=${skipped.substances} mitm=${skipped.mitm}`);
	console.log(`wrote ${SQL_PATH}`);
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
