import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runIngest } from "../src/ingest/run";
import { count, resetDb } from "./db";
import { detailCalls, type FakeOptions, fakeFetcher, fixtureText, LIST_HTML } from "./fixtures";

const OPTS = { dispoMinRows: 10, detailIntervalMs: 0 };
const TOTAL = LIST_HTML.match(/<tr class="product-item"/g)?.length as number;

const rowRe = (id: string): RegExp => new RegExp(`<tr class="product-item"\\s+data-id="${id}"[\\s\\S]*?</tr>`);

/** The list fixture with one row's `<tr>` passed through `edit` (empty string removes it). */
function editRow(html: string, id: string, edit: (tr: string) => string): string {
	const re = rowRe(id);
	if (!re.test(html)) throw new Error(`row ${id} not in list`);
	return html.replace(re, edit);
}

const removeRow = (html: string, id: string): string => editRow(html, id, () => "");
const setLabel = (html: string, id: string, label: string): string =>
	editRow(html, id, (tr) => tr.replace(/(<td class="[^"]*">)[^<]*(<\/td>)/, `$1${label}$2`));
const setUpdated = (html: string, id: string, date: string): string =>
	editRow(html, id, (tr) => tr.replace(/(<td data-value="[^"]*">)\d{2}\/\d{2}\/\d{4}(<\/td>)/, `$1${date}$2`));

async function run(opts: FakeOptions = {}) {
	const f = fakeFetcher(opts);
	const res = await runIngest(env, f, OPTS);
	return { res, f };
}

const history = (id?: string) =>
	env.DB.prepare(
		`SELECT shortage_id, change_type, old_status, new_status, old_expected_return, new_expected_return FROM status_history${id ? " WHERE shortage_id = ?" : ""} ORDER BY id`,
	)
		.bind(...(id ? [id] : []))
		.all()
		.then((r) => r.results);

const shortage = (id: string) => env.DB.prepare("SELECT * FROM shortages WHERE id = ?").bind(id).first();

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
	await resetDb();
	vi.restoreAllMocks();
	logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("diff", () => {
	it("bootstrap writes every row but no history", async () => {
		const { res, f } = await run();
		expect(res.status).toBe("ok");
		expect(res.message).toBe("bootstrap; dispo=ok");
		expect(res.counts).toEqual({ entries_seen: TOTAL, entries_new: TOTAL, entries_changed: 0, entries_delisted: 0 });
		expect(detailCalls(f)).toHaveLength(TOTAL);
		expect(await count("SELECT COUNT(*) AS n FROM shortages WHERE listed = 1")).toBe(TOTAL);
		expect(await count("SELECT COUNT(*) AS n FROM status_history")).toBe(0);
		expect(await count("SELECT COUNT(*) AS n FROM bdpm_dispo")).toBe(50);
		expect(await shortage("1566")).toMatchObject({
			raw_name: "Clindamycine 600 mg/4ml, solution injectable",
			status: "tension",
			expected_return_raw: "Date de remise à disposition prévue fin novembre 2026",
			expected_return_earliest: "2026-11-01",
			ansm_published_at: "2026-07-29",
			missed_runs: 0,
			listed: 1,
		});
		expect(await shortage("1625")).toMatchObject({ scope: "hopital", scope_raw: "Situation à l'hôpital : rupture ;" });
		const run1 = await env.DB.prepare("SELECT * FROM ingest_runs").first();
		expect(run1).toMatchObject({ status: "ok", message: "bootstrap; dispo=ok", entries_seen: TOTAL, entries_new: TOTAL });
	});

	it("takes the DCI from the detail page only when the list has none", async () => {
		await run();
		// 1240 (Repevax) has no brackets in the list; it is served detail-tension.html (DCI nifédipine).
		expect((await shortage("1240"))?.dci_raw).toBe("nifédipine");
		expect((await shortage("1566"))?.dci_raw).toBe("clindamycine (phosphate de)");
	});

	it("a second identical run writes no history and fetches no detail page", async () => {
		await run();
		const { res, f } = await run();
		expect(res).toMatchObject({ status: "ok", message: "dispo=ok", detailsFetched: 0 });
		expect(res.counts).toEqual({ entries_seen: TOTAL, entries_new: 0, entries_changed: 0, entries_delisted: 0 });
		expect(detailCalls(f)).toEqual([]);
		expect(await count("SELECT COUNT(*) AS n FROM status_history")).toBe(0);
	});

	it("records a new entry", async () => {
		await run({ list: removeRow(LIST_HTML, "1566") });
		const { res, f } = await run();
		expect(res.counts.entries_new).toBe(1);
		expect(detailCalls(f)).toEqual([expect.stringContaining("clindamycine-600-mg")]);
		expect(await history()).toEqual([
			{
				shortage_id: "1566",
				change_type: "new",
				old_status: null,
				new_status: "tension",
				old_expected_return: null,
				new_expected_return: "Date de remise à disposition prévue fin novembre 2026",
			},
		]);
	});

	it("records a status change", async () => {
		await run();
		const { res } = await run({ list: setLabel(LIST_HTML, "1566", "Rupture de stock") });
		expect(res.counts.entries_changed).toBe(1);
		expect(await history()).toEqual([
			expect.objectContaining({ shortage_id: "1566", change_type: "status_change", old_status: "tension", new_status: "rupture" }),
		]);
		expect((await shortage("1566"))?.status).toBe("rupture");
	});

	it("records a return-date change with the raw texts", async () => {
		await run();
		const changed = fixtureText("ansm/detail-1566.html").replace("fin novembre 2026", "fin d&eacute;cembre 2026");
		const { res } = await run({
			list: setUpdated(LIST_HTML, "1566", "27/10/2026"),
			detail: (path) => (path.includes("clindamycine-600-mg") ? new Response(changed) : undefined),
		});
		expect(res.counts.entries_changed).toBe(1);
		expect(await history()).toEqual([
			{
				shortage_id: "1566",
				change_type: "return_date_change",
				old_status: "tension",
				new_status: "tension",
				old_expected_return: "Date de remise à disposition prévue fin novembre 2026",
				new_expected_return: "Date de remise à disposition prévue fin décembre 2026",
			},
		]);
		expect(await shortage("1566")).toMatchObject({ expected_return_earliest: "2026-12-01", ansm_updated_at: "2026-10-27" });
	});

	it("writes no return_date_change on tension -> remise", async () => {
		await run();
		const { res } = await run({ list: setLabel(LIST_HTML, "1624", "Remise à disposition") });
		expect(res.counts.entries_changed).toBe(1);
		expect(await history()).toEqual([
			expect.objectContaining({ shortage_id: "1624", change_type: "status_change", old_status: "tension", new_status: "remise_a_disposition" }),
		]);
		expect((await shortage("1624"))?.expected_return_raw).toBeNull();
	});

	it("keeps a row listed after one miss, delists after two, then relists", async () => {
		await run();
		const without = removeRow(LIST_HTML, "1566");

		let { res } = await run({ list: without });
		expect(res.counts.entries_delisted).toBe(0);
		expect(await shortage("1566")).toMatchObject({ listed: 1, missed_runs: 1 });
		expect(await history()).toEqual([]);

		({ res } = await run({ list: without }));
		expect(res.counts.entries_delisted).toBe(1);
		expect(await shortage("1566")).toMatchObject({ listed: 0, missed_runs: 2 });
		expect(await history("1566")).toEqual([expect.objectContaining({ change_type: "delisted", old_status: "tension" })]);

		({ res } = await run({ list: without }));
		expect(res.counts.entries_delisted).toBe(0);
		expect(await shortage("1566")).toMatchObject({ listed: 0, missed_runs: 2 });

		({ res } = await run());
		expect(await shortage("1566")).toMatchObject({ listed: 1, missed_runs: 0 });
		expect((await history("1566")).map((h) => h.change_type)).toEqual(["delisted", "relisted"]);
	});

	it("nulls detail_hash on a detail failure, keeps the fields and retries next run", async () => {
		await run();
		const before = await shortage("1566");
		const list = setUpdated(LIST_HTML, "1566", "27/10/2026");

		const { res, f } = await run({
			list,
			detail: (path) => (path.includes("clindamycine-600-mg") ? new Response("oops", { status: 500 }) : undefined),
		});
		expect(res).toMatchObject({ status: "ok", message: "detail_failed=1; dispo=ok" });
		expect(detailCalls(f)).toHaveLength(1);
		expect(await shortage("1566")).toMatchObject({
			detail_hash: null,
			expected_return_raw: before?.expected_return_raw,
			ansm_published_at: before?.ansm_published_at,
			ansm_updated_at: "2026-10-27",
		});
		expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ event: "detail_failed", id: "1566", reason: "HTTP 500" }));

		const retry = await run({ list });
		expect(detailCalls(retry.f)).toEqual([expect.stringContaining("clindamycine-600-mg")]);
		expect((await shortage("1566"))?.detail_hash).toBe(before?.detail_hash);

		const again = await run({ list });
		expect(detailCalls(again.f)).toEqual([]);
		expect(await count("SELECT COUNT(*) AS n FROM status_history")).toBe(0);
	});

	it("a detail failure on a new entry stores it with a null detail_hash", async () => {
		const { res } = await run({
			detail: (path) => (path.includes("clindamycine-600-mg") ? new Response("", { status: 404 }) : undefined),
		});
		expect(res.message).toBe("bootstrap; detail_failed=1; dispo=ok");
		expect(await shortage("1566")).toMatchObject({ detail_hash: null, scope: "inconnu", expected_return_raw: null, listed: 1 });
	});

	it("closes stale running runs before opening a new one", async () => {
		const old = new Date(Date.now() - 21 * 60 * 1000).toISOString();
		await env.DB.prepare("INSERT INTO ingest_runs (source, status, started_at) VALUES ('ansm', 'running', ?)").bind(old).run();
		await run();
		const rows = await env.DB.prepare("SELECT status, message FROM ingest_runs ORDER BY id").all();
		expect(rows.results).toEqual([
			{ status: "error", message: "stale running run" },
			{ status: "ok", message: "bootstrap; dispo=ok" },
		]);
	});

	it("keeps the counts within the D1 query budget", async () => {
		const spy = vi.spyOn(env.DB, "prepare");
		const batch = vi.spyOn(env.DB, "batch");
		await run();
		const direct = spy.mock.calls.length;
		// Every statement is either run directly or batched; count batches as one query each.
		const batched = batch.mock.calls.reduce((n, c) => n + c[0].length, 0);
		expect(direct - batched + batch.mock.calls.length).toBeLessThanOrEqual(50);
	});
});
