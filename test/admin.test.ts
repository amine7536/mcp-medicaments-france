import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANSM_LIST_URL } from "../src/ingest/http";
import { runIngest } from "../src/ingest/run";
import worker from "../src/index";
import { count, ran, resetDb } from "./db";
import { type FakeFetcher, fakeFetcher } from "./fixtures";

const TOKEN = "s3cret-token";
const URL = "https://ruptures-medicaments.a3e.dev/admin/ingest";

async function call(init: RequestInit<IncomingRequestCfProperties> = {}, testEnv: Env = env): Promise<Response> {
	const ctx = createExecutionContext();
	const res = await worker.fetch(new Request<unknown, IncomingRequestCfProperties>(URL, { method: "POST", ...init }), testEnv, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

// An empty list aborts the run before any other request, which keeps route tests fast.
const SHORT_LIST = "<html><body><table></table></body></html>";

const auth = { Authorization: `Bearer ${TOKEN}` };

let fake: FakeFetcher;

beforeEach(async () => {
	await resetDb();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	// The routes pass the global fetch to the ingest; serve fixtures instead of the network.
	fake = fakeFetcher();
	vi.stubGlobal("fetch", fake);
	vi.spyOn(console, "log").mockImplementation(() => {});
});

const runs = () => count("SELECT COUNT(*) AS n FROM ingest_runs");

describe("POST /admin/ingest", () => {
	it("404 when the secret is unset or empty", async () => {
		// ADMIN_TOKEN is a required secret in the types; drop it to simulate an unset secret.
		const { ADMIN_TOKEN: _, ...unset } = env;
		for (const testEnv of [unset as unknown as Env, { ...env, ADMIN_TOKEN: "" }]) {
			const res = await call({ headers: auth }, testEnv);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({ error: "not_found" });
		}
		expect(fake.calls).toEqual([]);
	});

	it("reads the secret from the env bindings", () => {
		expect(env.ADMIN_TOKEN).toBe(TOKEN);
	});

	it("401 on a missing or bad token, for any method", async () => {
		const tse = vi.spyOn(crypto.subtle, "timingSafeEqual");
		for (const method of ["POST", "GET"]) {
			for (const headers of [{}, { Authorization: "Bearer wrong" }, { Authorization: TOKEN }] as Record<string, string>[]) {
				const res = await call({ method, headers });
				expect(res.status).toBe(401);
				expect(await res.json()).toEqual({ error: "unauthorized" });
			}
		}
		expect(tse).toHaveBeenCalledTimes(6);
		for (const [a, b] of tse.mock.calls) expect([(a as ArrayBuffer).byteLength, (b as ArrayBuffer).byteLength]).toEqual([32, 32]);
		expect(fake.calls).toEqual([]);
	});

	it("405 on an authenticated GET", async () => {
		const res = await call({ method: "GET", headers: auth });
		expect(res.status).toBe(405);
		expect(res.headers.get("Allow")).toBe("POST");
		expect(fake.calls).toEqual([]);
		expect(await runs()).toBe(0);
	});

	it("409 while a run holds the claim", async () => {
		await env.DB.prepare("INSERT INTO ingest_runs (source, status, started_at) VALUES ('ansm', 'running', ?)")
			.bind(new Date(Date.now() - 60_000).toISOString())
			.run();
		const res = await call({ headers: auth });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: "ingest_running" });
		expect(fake.calls).toEqual([]);
		expect(await runs()).toBe(1);
	});

	it("200 with the run summary, ignoring stale running runs", async () => {
		await env.DB.prepare("INSERT INTO ingest_runs (source, status, started_at) VALUES ('ansm', 'running', ?)")
			.bind(new Date(Date.now() - 21 * 60_000).toISOString())
			.run();
		fake = fakeFetcher({ list: SHORT_LIST });
		vi.stubGlobal("fetch", fake);
		const res = await call({ headers: auth });
		expect(res.status).toBe(200);
		const last = await env.DB.prepare("SELECT id, status, message FROM ingest_runs ORDER BY id DESC LIMIT 1").first<{ id: number }>();
		expect(await res.json()).toEqual({
			run_id: last?.id,
			status: "aborted",
			message: "bootstrap; list has 0 rows",
			entries_seen: 0,
			entries_new: null,
			entries_changed: null,
			entries_delisted: null,
		});
		expect(fake.calls[0]).toBe(ANSM_LIST_URL);
		expect(last).toMatchObject({ status: "aborted", message: "bootstrap; list has 0 rows" });
	});

	it("leaves other paths at 404", async () => {
		const ctx = createExecutionContext();
		const res = await worker.fetch(new Request<unknown, IncomingRequestCfProperties>("https://x/admin"), env, ctx);
		expect(res.status).toBe(404);
	});
});

describe("hook", { timeout: 30_000 }, () => {
	it("a thrown hook error keeps the run ok", async () => {
		const hook = vi.fn().mockRejectedValue(new Error("boom"));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const res = ran(await runIngest(env, fakeFetcher(), { dispoMinRows: 10, detailIntervalMs: 0, afterIngest: hook }));
		expect(res).toMatchObject({ status: "ok", message: "bootstrap; dispo=ok" });
		expect(hook).toHaveBeenCalledWith(env, { id: res.id, bootstrap: true });
		expect(log).toHaveBeenCalledWith(JSON.stringify({ event: "hook_failed", id: res.id, reason: "boom" }));
		const row = await env.DB.prepare("SELECT status FROM ingest_runs WHERE id = ?").bind(res.id).first();
		expect(row).toEqual({ status: "ok" });
	});

	it("appends the hook fragment to the message", async () => {
		const afterIngest = vi.fn().mockResolvedValue("matched=3");
		const res = ran(await runIngest(env, fakeFetcher(), { dispoMinRows: 10, detailIntervalMs: 0, afterIngest }));
		expect(res.message).toBe("bootstrap; dispo=ok; matched=3");
	});
});

describe("scheduled", () => {
	it("starts an ingest with the global fetch", async () => {
		fake = fakeFetcher({ list: SHORT_LIST });
		vi.stubGlobal("fetch", fake);
		const ctx = createExecutionContext();
		await worker.scheduled({ scheduledTime: Date.now(), cron: "0 5 * * *", noRetry() {} }, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(fake.calls[0]).toBe(ANSM_LIST_URL);
		expect(await env.DB.prepare("SELECT status FROM ingest_runs").first()).toEqual({ status: "aborted" });
	});

	it("logs ingest_skipped while a run holds the claim", async () => {
		await env.DB.prepare("INSERT INTO ingest_runs (source, status, started_at) VALUES ('ansm', 'running', ?)")
			.bind(new Date(Date.now() - 60_000).toISOString())
			.run();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const ctx = createExecutionContext();
		await worker.scheduled({ scheduledTime: Date.now(), cron: "0 5 * * *", noRetry() {} }, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(log).toHaveBeenCalledWith(JSON.stringify({ event: "ingest_skipped" }));
		expect(fake.calls).toEqual([]);
		expect(await runs()).toBe(1);
	});
});
