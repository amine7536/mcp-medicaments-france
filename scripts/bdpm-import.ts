import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchBytes } from "./bdpm/download";
import { buildHasSql, HAS_FILES, mapHas } from "./bdpm/has";
import { FILES, validateAndMap } from "./bdpm/map";
import { decodeCp1252 } from "../src/lib/cp1252";
import { parseTsv } from "../src/lib/tsv";
import { errorMessage } from "../src/ingest/http";
import { decodeUtf8, parseBanner } from "./bdpm/parse";
import { buildImportSql } from "./bdpm/sql";

const BASE = "https://base-donnees-publique.medicaments.gouv.fr";
const OUT_DIR = ".bdpm";
const SQL_PATH = join(OUT_DIR, "bdpm.sql");

async function download(url: string, fileName: string): Promise<Uint8Array> {
	const bytes = await fetchBytes(fetch, url);
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
	const presentationsBytes = await download(`${BASE}/download/file/${FILES.presentations.name}`, FILES.presentations.name);
	const conditionsBytes = await download(`${BASE}/download/file/${FILES.prescriptionConditions.name}`, FILES.prescriptionConditions.name);
	// Generated at request time, outside the monthly `/download/file/` release.
	const safetyBytes = await download(`${BASE}/download/${FILES.safetyInformation.name}`, FILES.safetyInformation.name);
	const smrBytes = await download(`${BASE}/download/file/${HAS_FILES.smr.name}`, HAS_FILES.smr.name);
	const asmrBytes = await download(`${BASE}/download/file/${HAS_FILES.asmr.name}`, HAS_FILES.asmr.name);
	const ctLinksBytes = await download(`${BASE}/download/file/${HAS_FILES.ctLinks.name}`, HAS_FILES.ctLinks.name);
	const pageBytes = await download(`${BASE}/telechargement`, "telechargement.html");

	const bannerDate = parseBanner(new TextDecoder().decode(pageBytes));
	const mapped = validateAndMap({
		cisBdpm: parseTsv(decodeCp1252(cisBdpmBytes), FILES.cisBdpm.cols, FILES.cisBdpm.name),
		compo: parseTsv(decodeCp1252(compoBytes), FILES.compo.cols, FILES.compo.name),
		mitm: parseTsv(decodeCp1252(mitmBytes), FILES.mitm.cols, FILES.mitm.name),
		presentations: parseTsv(decodeUtf8(presentationsBytes), FILES.presentations.cols, FILES.presentations.name),
		prescriptionConditions: parseTsv(decodeCp1252(conditionsBytes), FILES.prescriptionConditions.cols, FILES.prescriptionConditions.name, {
			skipEmptyLines: true,
		}),
		safetyInformation: parseTsv(decodeUtf8(safetyBytes), FILES.safetyInformation.cols, FILES.safetyInformation.name),
		bannerDate,
	});
	// validateAndMap throws when the banner date is missing.
	const release = bannerDate as string;

	const has = mapHas(
		{
			smr: parseTsv(decodeCp1252(smrBytes), HAS_FILES.smr.cols, HAS_FILES.smr.name),
			asmr: parseTsv(decodeCp1252(asmrBytes), HAS_FILES.asmr.cols, HAS_FILES.asmr.name),
			ctLinks: parseTsv(decodeUtf8(ctLinksBytes), HAS_FILES.ctLinks.cols, HAS_FILES.ctLinks.name),
		},
		new Set(mapped.medicines.map((m) => m.cis)),
	);

	const sql = buildImportSql({ ...mapped, release, startedAt, finishedAt: new Date().toISOString() });
	await writeFile(SQL_PATH, `${buildHasSql(has).join("\n")}\n${sql}`);

	const { skipped } = mapped;
	console.log(`BDPM release ${release}`);
	console.log(
		`medicines=${mapped.medicines.length} substances=${mapped.substances.length} composition=${mapped.composition.length} mitm=${mapped.mitm.length} fts=${mapped.fts.length} presentations=${mapped.presentations.length} prescription_conditions=${mapped.prescription_conditions.length} safety_information=${mapped.safety_information.length}`,
	);
	console.log(`skipped medicines=${skipped.medicines} substances=${skipped.substances} mitm=${skipped.mitm} fractions=${skipped.fractions}`);
	const smrKept = has.opinions.filter((o) => o.kind === "smr").length;
	console.log(
		`has smr=${smrKept} asmr=${has.opinions.length - smrKept} ct_links=${has.ct_links.length}; skipped unknown CIS smr=${has.skipped.smr} asmr=${has.skipped.asmr}; dropped multi-page dossiers=${has.multiPageDossiers}`,
	);
	console.log(`wrote ${SQL_PATH}`);
}

main().catch((err: unknown) => {
	console.error(errorMessage(err));
	process.exit(1);
});
