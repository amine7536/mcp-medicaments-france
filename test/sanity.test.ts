import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Status } from "../src/ingest/ansm";
import { DISPO_URL } from "../src/ingest/http";
import { runIngest } from "../src/ingest/run";
import { checkSanity } from "../src/ingest/sanity";
import { count, resetDb } from "./db";
import { fakeFetcher, LIST_HTML } from "./fixtures";

const rows = (n: number, autre = 0): { id: string; status: Status }[] =>
	Array.from({ length: n }, (_, i) => ({ id: String(i), status: i < autre ? "autre" : "rupture" }));
const ctx = (previousOkSeen: number | null = null, listed: string[] = []) => ({ previousOkSeen, currentlyListedIds: new Set(listed) });
const ids = (n: number, from = 0): string[] => Array.from({ length: n }, (_, i) => String(from + i));

describe("checkSanity", () => {
	it("passes a healthy list", () => {
		expect(checkSanity(rows(290), ctx(290, ids(290)))).toEqual({ ok: true });
	});

	it("1. aborts on 0 rows", () => {
		expect(checkSanity([], ctx())).toEqual({ ok: false, reason: "list has 0 rows" });
	});

	it("2. aborts below the absolute floor of 200", () => {
		expect(checkSanity(rows(199), ctx())).toEqual({ ok: false, reason: "list has 199 rows, below 200" });
		expect(checkSanity(rows(200), ctx()).ok).toBe(true);
	});

	it("3. aborts below 60% of the previous ok run", () => {
		expect(checkSanity(rows(299), ctx(500))).toEqual({ ok: false, reason: "list has 299 rows, below 60% of previous 500" });
		expect(checkSanity(rows(300), ctx(500)).ok).toBe(true);
	});

	it("4. aborts when more than 20% of rows are autre", () => {
		expect(checkSanity(rows(250, 51), ctx())).toEqual({ ok: false, reason: "51 of 250 rows have an unknown status" });
		expect(checkSanity(rows(250, 50), ctx()).ok).toBe(true);
	});

	it("5. aborts when more than 10% of listed ids are absent", () => {
		expect(checkSanity(rows(250), ctx(250, [...ids(224), ...ids(26, 1000)]))).toEqual({
			ok: false,
			reason: "26 of 250 listed entries are absent",
		});
		expect(checkSanity(rows(250), ctx(250, [...ids(225), ...ids(25, 1000)])).ok).toBe(true);
	});

	it("applies the first matching rule", () => {
		expect(checkSanity(rows(10, 10), ctx(500, ids(500)))).toEqual({ ok: false, reason: "list has 10 rows, below 200" });
	});
});

describe("runIngest abort and error paths", () => {
	const hook = vi.fn(async () => "");

	beforeEach(async () => {
		await resetDb();
		hook.mockClear();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	async function expectNothingWritten(): Promise<void> {
		expect(await count("SELECT COUNT(*) AS n FROM shortages")).toBe(0);
		expect(await count("SELECT COUNT(*) AS n FROM status_history")).toBe(0);
		expect(await count("SELECT COUNT(*) AS n FROM bdpm_dispo")).toBe(0);
		expect(hook).not.toHaveBeenCalled();
	}

	it("an abort skips the shortage file, the details and the hook", async () => {
		const truncated = LIST_HTML.replace(/(<tr class="product-item"[\s\S]*?<\/tr>\s*){150}/, "");
		const f = fakeFetcher({ list: truncated });
		const res = await runIngest(env, f, { dispoMinRows: 10, detailIntervalMs: 0, afterIngest: hook });
		expect(res.status).toBe("aborted");
		expect(res.message).toBe("bootstrap; list has 140 rows, below 200");
		expect(f.calls).toHaveLength(1);
		expect(f.calls).not.toContain(DISPO_URL);
		await expectNothingWritten();
		const run = await env.DB.prepare("SELECT status, message, entries_seen, finished_at FROM ingest_runs").first();
		expect(run).toMatchObject({ status: "aborted", message: "bootstrap; list has 140 rows, below 200", entries_seen: 140 });
		expect(run?.finished_at).not.toBeNull();
	});

	it("a non-200 list ends error without writes", async () => {
		const f = fakeFetcher({ list: () => new Response("busy", { status: 503 }) });
		const res = await runIngest(env, f, { dispoMinRows: 10, detailIntervalMs: 0, afterIngest: hook });
		expect(res).toMatchObject({ status: "error", message: "list fetch failed: HTTP 503" });
		expect(f.calls).toHaveLength(1);
		await expectNothingWritten();
	});

	it("a network error on the list ends error without writes", async () => {
		const f = fakeFetcher({
			list: () => {
				throw new TypeError("Network connection lost.");
			},
		});
		const res = await runIngest(env, f, { dispoMinRows: 10, detailIntervalMs: 0, afterIngest: hook });
		expect(res).toMatchObject({ status: "error", message: "Network connection lost." });
		await expectNothingWritten();
		expect(await count("SELECT COUNT(*) AS n FROM ingest_runs WHERE status = 'error'")).toBe(1);
	});
});
