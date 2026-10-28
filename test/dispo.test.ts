import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestDispo, parseDispo, replaceDispo } from "../src/ingest/dispo";
import { DISPO_URL } from "../src/ingest/http";
import { count, resetDb } from "./db";
import { fakeFetcher, fixtureBytes } from "./fixtures";

const BYTES = fixtureBytes("bdpm/CIS_CIP_Dispo_Spec.txt");

beforeEach(async () => {
	await resetDb();
	vi.restoreAllMocks();
});

describe("parseDispo", () => {
	it("decodes windows-1252 and extracts the ANSM path", () => {
		const rows = parseDispo(BYTES, 10);
		expect(rows).toHaveLength(50);
		expect(rows[0]).toEqual({
			cis: "63922956",
			cip13: null,
			status_code: 1,
			status_label: "Rupture de stock",
			date_debut: "2026-10-26",
			date_maj: "2026-10-26",
			date_remise: null,
			ansm_path: "/disponibilites-des-produits-de-sante/medicaments/brevibloc-100-mg-10-ml-solution-injectable-en-flacon-esmolol-chlorhydrate-d",
		});
		const labels = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status_label]: (acc[r.status_label] ?? 0) + 1 }), {});
		expect(labels).toEqual({
			"Arrêt de commercialisation": 2,
			"Remise à disposition": 15,
			"Rupture de stock": 8,
			"Tension d'approvisionnement": 25,
		});
		expect(rows.filter((r) => r.cip13 !== null)).toHaveLength(3);
		expect(rows.every((r) => r.ansm_path.startsWith("/") && !r.ansm_path.endsWith("/"))).toBe(true);
	});

	it("rejects a wrong column count and too few rows", () => {
		expect(() => parseDispo(new TextEncoder().encode("a\tb\r\n"), 1)).toThrow("CIS_CIP_Dispo_Spec.txt: line 1 has 2 columns, expected 8");
		expect(() => parseDispo(BYTES)).toThrow("50 rows, expected at least 200");
	});

	it("drops empty lines and strips a trailing slash", () => {
		const line = "60000001\t\t2\tTension\t01/01/2026\t\t\thttps://ansm.sante.fr/a/b/";
		expect(parseDispo(new TextEncoder().encode(`${line}\r\n\r\n${line}\n`), 2).map((r) => r.ansm_path)).toEqual(["/a/b", "/a/b"]);
	});

	it("keeps rejecting dates before 2000", () => {
		const line = "60000001\t\t2\tTension\t31/12/1999\t01/01/2000\t\thttps://ansm.sante.fr/a/b";
		const [row] = parseDispo(new TextEncoder().encode(line), 1);
		expect(row?.date_debut).toBeNull();
		expect(row?.date_maj).toBe("2000-01-01");
	});
});

describe("ingestDispo", () => {
	it("replaces the table on valid input", async () => {
		await replaceDispo(env.DB, parseDispo(BYTES, 10).slice(0, 5));
		expect(await ingestDispo(env.DB, fakeFetcher(), 10)).toBe("ok");
		expect(await count("SELECT COUNT(*) AS n FROM bdpm_dispo")).toBe(50);
	});

	it("keeps the existing rows on invalid input and logs dispo_failed", async () => {
		await replaceDispo(env.DB, parseDispo(BYTES, 10));
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const broken = new Uint8Array([...BYTES.slice(0, 200), 0x0a, 0x78, 0x0a]);
		expect(await ingestDispo(env.DB, fakeFetcher({ dispo: broken }), 10)).toBe("failed");
		expect(await ingestDispo(env.DB, fakeFetcher(), 200)).toBe("failed");
		expect(await ingestDispo(env.DB, fakeFetcher({ dispo: () => new Response("", { status: 503 }) }), 10)).toBe("failed");
		expect(await count("SELECT COUNT(*) AS n FROM bdpm_dispo")).toBe(50);
		const events = spy.mock.calls.map((c) => JSON.parse(c[0] as string).event);
		expect(events).toEqual(["dispo_failed", "dispo_failed", "dispo_failed"]);
	});

	it("fetches the BDPM URL", async () => {
		const f = fakeFetcher();
		await ingestDispo(env.DB, f, 10);
		expect(f.calls).toEqual([DISPO_URL]);
	});
});
