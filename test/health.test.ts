import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Health, loadHealth } from "../src/health";
import worker from "../src/index";
import { normalize } from "../src/lib/normalize";
import { loadSourceDates } from "../src/mcp/envelope";
import { resetDb } from "./db";
import { ANSM_LAST_INGEST, BDPM_IMPORTED_AT, BDPM_RELEASE, NOW, seed } from "./seed";

const URL = "https://medicaments-france.a3e.dev/health";

const minutesBefore = (at: Date, m: number): string => new Date(at.getTime() - m * 60_000).toISOString();

async function addRun(status: string, startedAt: string, finishedAt: string | null, message: string | null = null): Promise<void> {
	await env.DB.prepare("INSERT INTO ingest_runs (source, started_at, finished_at, status, message) VALUES ('ansm', ?, ?, ?, ?)")
		.bind(startedAt, finishedAt, status, message)
		.run();
}

const clearRuns = () => env.DB.prepare("DELETE FROM ingest_runs WHERE source = 'ansm'").run();

async function addShortage(
	id: string,
	status: string,
	scope: string,
	raw: string | null,
	earliest: string | null,
	listed = 1,
	lost: string | null = null,
	detailHash: string | null = "d",
): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, scope, expected_return_raw, expected_return_earliest, expected_return_lost_raw, list_hash, detail_hash, first_seen_at, last_seen_at, listed)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'h', ?, ?, ?, ?)`,
	)
		.bind(id, `/x/${id}`, `PRODUIT ${id}`, normalize(`PRODUIT ${id}`), status, status, scope, raw, earliest, lost, detailHash, ANSM_LAST_INGEST, ANSM_LAST_INGEST, listed)
		.run();
}

async function get(testEnv: Env = env, url = URL, method = "GET"): Promise<Response> {
	const ctx = createExecutionContext();
	const res = await worker.fetch(new Request<unknown, IncomingRequestCfProperties>(url, { method }), testEnv, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

beforeEach(async () => {
	vi.restoreAllMocks();
	await caches.default.delete(URL);
	await seed();
});

describe("loadHealth", () => {
	it("reports the seeded ingest, listed-only counts and the match rate", async () => {
		const h = await loadHealth(env.DB, NOW);
		expect(h).toEqual({
			status: "ok",
			ansm: {
				last_ok_at: ANSM_LAST_INGEST,
				last_run: { started_at: "2026-10-27T05:00:00.000Z", finished_at: ANSM_LAST_INGEST, status: "ok", message: null },
			},
			bdpm: { release: BDPM_RELEASE, imported_at: BDPM_IMPORTED_AT },
			// The delisted rupture (1008) is not counted.
			counts: {
				listed: 7,
				by_status: { rupture: 1, tension: 3, remise_a_disposition: 1, arret_commercialisation: 1, autre: 1 },
				medicines: 5,
				mitm: 2,
				bdpm_dispo: 0,
			},
			// 1001, 1006 and 1003 match at 1.0; 1002 only at 0.6.
			match: { matched_ge_0_8: 3, rate: 0.429 },
			quality: { unknown_status: 1, scope_inconnu: 0, return_unparsed: 0, return_lost: 0, unmatched: 3, detail_pending: 0 },
			generated_at: NOW.toISOString(),
		} satisfies Health);
	});

	it("reports the BDPM import time the tool envelope reports", async () => {
		expect((await loadHealth(env.DB, NOW)).bdpm.imported_at).toBe((await loadSourceDates(env.DB)).bdpm_imported_at);
	});

	it("counts parser drift on listed rows only", async () => {
		await addShortage("2001", "tension", "inconnu", "Remise à disposition prévue prochainement", null);
		await addShortage("2002", "rupture", "ville", "Date de remise à disposition INDÉTERMINÉE", null);
		await addShortage("2003", "rupture", "ville", "Remise indéterminée", null);
		await addShortage("2004", "autre", "inconnu", "Texte libre", null);
		await addShortage("2005", "tension", "inconnu", "Texte libre", null, 0);
		await addShortage("2006", "remise_a_disposition", "inconnu", null, null);
		const { quality, counts } = await loadHealth(env.DB, NOW);
		expect(counts.listed).toBe(12);
		// 2005 is delisted; 2004 and 2006 are neither rupture nor tension; 2002/2003 are undetermined.
		expect(quality).toEqual({ unknown_status: 2, scope_inconnu: 1, return_unparsed: 1, return_lost: 0, unmatched: 3 + 5, detail_pending: 0 });
	});

	it("does not count an inconnue return as unparsed", async () => {
		await addShortage("2011", "rupture", "ville", "Date de remise à disposition normale inconnue", null);
		expect((await loadHealth(env.DB, NOW)).quality.return_unparsed).toBe(0);
	});

	it("counts listed rows waiting for a detail refetch", async () => {
		await addShortage("2012", "tension", "ville", null, null, 1, null, null);
		await addShortage("2013", "remise_a_disposition", "inconnu", null, null, 1, null, null);
		await addShortage("2014", "tension", "ville", null, null, 0, null, null);
		// 2014 is delisted; every status counts.
		expect((await loadHealth(env.DB, NOW)).quality.detail_pending).toBe(2);
	});

	it("does not count the indérminée typo as unparsed", async () => {
		await addShortage("2007", "tension", "ville", "Date de remise à disposition prévue indérminée", null);
		expect((await loadHealth(env.DB, NOW)).quality.return_unparsed).toBe(0);
	});

	it("counts listed rupture and tension rows whose return line was lost", async () => {
		const lost = "Remise à disposition prévue fin décembre 2026.";
		await addShortage("2008", "tension", "ville", null, null, 1, lost);
		await addShortage("2009", "rupture", "ville", null, null, 0, lost);
		await addShortage("2010", "remise_a_disposition", "ville", null, null, 1, lost);
		// 2009 is delisted; 2010 is neither rupture nor tension.
		expect((await loadHealth(env.DB, NOW)).quality.return_lost).toBe(1);
	});

	it("has a null rate without listed shortages", async () => {
		await env.DB.prepare("DELETE FROM shortages").run();
		const { match, counts } = await loadHealth(env.DB, NOW);
		expect(match).toEqual({ matched_ge_0_8: 0, rate: null });
		expect(counts.by_status).toEqual({ rupture: 0, tension: 0, remise_a_disposition: 0, arret_commercialisation: 0, autre: 0 });
	});

	it("is stale without an ok run or after 72 h", async () => {
		expect((await loadHealth(env.DB, new Date(Date.parse(ANSM_LAST_INGEST) + 72 * 3600_000))).status).toBe("ok");
		expect((await loadHealth(env.DB, new Date(Date.parse(ANSM_LAST_INGEST) + 72 * 3600_000 + 1))).status).toBe("stale");
		await clearRuns();
		const h = await loadHealth(env.DB, NOW);
		expect(h.status).toBe("stale");
		expect(h.ansm).toEqual({ last_ok_at: null, last_run: null });
	});

	it("is degraded when the latest run aborted or failed", async () => {
		for (const status of ["aborted", "error"]) {
			await addRun(status, minutesBefore(NOW, 30), minutesBefore(NOW, 29), "boom");
			const h = await loadHealth(env.DB, NOW);
			expect(h.status).toBe("degraded");
			expect(h.ansm.last_run).toMatchObject({ status, message: "boom" });
			expect(h.ansm.last_ok_at).toBe(ANSM_LAST_INGEST);
		}
	});

	it("is degraded when a run is stuck running for over 20 minutes", async () => {
		await addRun("running", minutesBefore(NOW, 20), null);
		expect((await loadHealth(env.DB, NOW)).status).toBe("ok");
		await env.DB.prepare("UPDATE ingest_runs SET started_at = ? WHERE status = 'running'").bind(minutesBefore(NOW, 21)).run();
		expect((await loadHealth(env.DB, NOW)).status).toBe("degraded");
	});

	it("stale wins over degraded", async () => {
		await addRun("error", minutesBefore(NOW, 10), minutesBefore(NOW, 9));
		expect((await loadHealth(env.DB, new Date(NOW.getTime() + 72 * 3600_000))).status).toBe("stale");
	});
});

describe("GET /health", () => {
	it("200 when ok, cached for 5 minutes", async () => {
		await clearRuns();
		const now = new Date().toISOString();
		await addRun("ok", now, now);
		const res = await get();
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(res.headers.get("cache-control")).toBe("public, max-age=300");
		const body = await res.json<Health>();
		expect(body.status).toBe("ok");

		// Served from the cache: a later failed run is not visible yet.
		await addRun("error", new Date().toISOString(), new Date().toISOString());
		const again = await get();
		expect(again.status).toBe(200);
		expect((await again.json<Health>()).generated_at).toBe(body.generated_at);
	});

	it("ignores the query string in the cache key", async () => {
		await clearRuns();
		const now = new Date().toISOString();
		await addRun("ok", now, now);
		const body = await (await get()).json<Health>();
		await addRun("error", new Date().toISOString(), new Date().toISOString());
		const again = await get(env, `${URL}?x=1`);
		expect(again.status).toBe(200);
		expect((await again.json<Health>()).generated_at).toBe(body.generated_at);
	});

	it("503 when stale or degraded, and the 503 is cached", async () => {
		// Miniflare's cache never stores a 503 (Cloudflare does, given an explicit max-age), so assert what is written.
		const put = vi.spyOn(caches.default, "put").mockResolvedValue(undefined);
		await clearRuns();
		const res = await get();
		expect(res.status).toBe(503);
		const body = await res.json<Health>();
		expect(body.status).toBe("stale");
		expect(put).toHaveBeenCalledOnce();
		const [key, stored] = put.mock.calls[0] as [Request, Response];
		expect(key.url).toBe(URL);
		expect(stored.status).toBe(503);
		expect(stored.headers.get("cache-control")).toBe("public, max-age=300");
		expect(await stored.json()).toEqual(body);

		const now = new Date().toISOString();
		await addRun("ok", now, now);
		await addRun("aborted", new Date().toISOString(), new Date().toISOString());
		const degraded = await get();
		expect(degraded.status).toBe(503);
		expect((await degraded.json<Health>()).status).toBe("degraded");
	});

	it("503 error, uncached, when D1 fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const put = vi.spyOn(caches.default, "put");
		const broken = new Proxy(env.DB, {
			get(target, prop) {
				if (prop === "prepare" || prop === "batch") return () => { throw new Error("D1_ERROR: database unavailable"); };
				return Reflect.get(target, prop);
			},
		});
		const res = await get({ ...env, DB: broken });
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ status: "error" });
		expect(put).not.toHaveBeenCalled();
		expect(await caches.default.match(URL)).toBeUndefined();
	});
});

describe("HEAD /health", () => {
	it("200", async () => {
		await clearRuns();
		const now = new Date().toISOString();
		await addRun("ok", now, now);
		const res = await get(env, URL, "HEAD");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("");
	});
});

describe("non-GET methods", () => {
	it("405 with Allow: GET, HEAD on POST / and POST /health, without touching D1", async () => {
		const broken = new Proxy(env.DB, {
			get() {
				throw new Error("D1 accessed");
			},
		});
		for (const url of ["https://medicaments-france.a3e.dev/", URL]) {
			const res = await get({ ...env, DB: broken }, url, "POST");
			expect(res.status).toBe(405);
			expect(res.headers.get("Allow")).toBe("GET, HEAD");
		}
	});
});

describe("unknown paths", () => {
	it("keep the 404 JSON", async () => {
		await resetDb();
		const res = await worker.fetch(new Request<unknown, IncomingRequestCfProperties>("https://medicaments-france.a3e.dev/healthz"), env, createExecutionContext());
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "not_found" });
	});

	it("does not percent-decode the path", async () => {
		const res = await worker.fetch(new Request<unknown, IncomingRequestCfProperties>("https://medicaments-france.a3e.dev/%68ealth"), env, createExecutionContext());
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "not_found" });
	});
});
