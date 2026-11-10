import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelAnswer } from "../src/ingest/extract";
import { runIngest } from "../src/ingest/run";
import { loadHealth } from "../src/health";
import { count, queryCount, ran, resetDb } from "./db";
import { detailCalls, FIXTURE_ANSWERS, type FakeOptions, fakeFetcher, fixtureText, LIST_HTML, NO_ANSWER, stubExtract } from "./fixtures";

const OPTS = { dispoMinRows: 10, detailIntervalMs: 0, afterIngest: async () => "" };
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

interface RunOptions extends FakeOptions {
	/** Model answers by list id (default `FIXTURE_ANSWERS`). */
	answers?: Record<string, ModelAnswer>;
}

async function run({ answers = FIXTURE_ANSWERS, ...opts }: RunOptions = {}) {
	const f = fakeFetcher(opts);
	const res = ran(await runIngest(env, f, { ...OPTS, extract: stubExtract(answers) }));
	return { res, f };
}

/** `FIXTURE_ANSWERS` with 1566's return read from its 4th line as `retour`. */
const answers1566 = (retour: string): Record<string, ModelAnswer> => ({ ...FIXTURE_ANSWERS, "1566": { ...NO_ANSWER, ligne_retour: 4, retour } });

const history = (id?: string) =>
	env.DB.prepare(
		`SELECT shortage_id, change_type, old_status, new_status, old_expected_return, new_expected_return FROM status_history${id ? " WHERE shortage_id = ?" : ""} ORDER BY id`,
	)
		.bind(...(id ? [id] : []))
		.all()
		.then((r) => r.results);

const shortage = (id: string) => env.DB.prepare("SELECT * FROM shortages WHERE id = ?").bind(id).first();

const RETURN_LI = "<li>Date de remise &agrave; disposition pr&eacute;vue fin novembre 2026</li>";

/** A 1566 return line and the date expression the model reads from it. */
interface ReturnLine {
	line: string;
	retour: string;
}

/** Serves the 1566 detail with its return line replaced (removed when null), with the matching model answer. */
function serveReturn(ret: ReturnLine | null): Pick<RunOptions, "detail" | "answers"> {
	const html = fixtureText("ansm/detail-1566.html").replace(RETURN_LI, ret === null ? "" : `<li>${ret.line}</li>`);
	return {
		detail: (path) => (path.includes("clindamycine-600-mg") ? new Response(html) : undefined),
		answers: ret === null ? { ...FIXTURE_ANSWERS, "1566": NO_ANSWER } : answers1566(ret.retour),
	};
}

/** Runs once with `before` as 1566's return line, then again with `after` and the list row updated. */
async function twoReturns(before: ReturnLine | null, after: ReturnLine | null) {
	await run(serveReturn(before));
	expect((await shortage("1566"))?.expected_return_raw).toBe(before?.line ?? null);
	return run({ list: setUpdated(LIST_HTML, "1566", "27/10/2026"), ...serveReturn(after) });
}

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
	await resetDb();
	vi.restoreAllMocks();
	logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("diff", { timeout: 30_000 }, () => {
	it("spaces detail requests with scheduler.wait", async () => {
		const wait = vi.spyOn(scheduler, "wait").mockResolvedValue(undefined);
		const res = ran(await runIngest(env, fakeFetcher(), { ...OPTS, detailIntervalMs: 60_000, extract: stubExtract() }));
		expect(res.status).toBe("ok");
		// Each of the 4 lanes skips the wait once the queue is empty.
		expect(wait).toHaveBeenCalledTimes(res.detailsFetched - 4);
		for (const [ms] of wait.mock.calls) expect(ms).toBeGreaterThan(0);
		for (const [ms] of wait.mock.calls) expect(ms).toBeLessThanOrEqual(60_000);
	});

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
			answers: answers1566("fin décembre 2026"),
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

	it("writes no return_date_change when ANSM only rewords punctuation", async () => {
		const detail = fixtureText("ansm/detail-1566.html");
		const before = detail.replace("pr&eacute;vue fin novembre 2026", "pr&eacute;vue ind&eacute;termin&eacute;e");
		const after = detail.replace("pr&eacute;vue fin novembre 2026", "pr&eacute;vue : ind&eacute;termin&eacute;e.");
		const serve = (html: string) => (path: string) => (path.includes("clindamycine-600-mg") ? new Response(html) : undefined);
		const answers = answers1566("indéterminée");
		await run({ detail: serve(before), answers });
		expect((await shortage("1566"))?.expected_return_raw).toBe("Date de remise à disposition prévue indéterminée");
		const { res } = await run({ list: setUpdated(LIST_HTML, "1566", "27/10/2026"), detail: serve(after), answers });
		expect(await history()).toEqual([]);
		expect(res.counts.entries_changed).toBe(0);
		expect((await shortage("1566"))?.expected_return_raw).toBe("Date de remise à disposition prévue : indéterminée.");
	});

	it("records a return_date_change when the date changes along with the wording", async () => {
		const detail = fixtureText("ansm/detail-1566.html");
		const before = detail.replace("pr&eacute;vue fin novembre 2026", "pr&eacute;vue fin octobre 2026.");
		const after = detail.replace("pr&eacute;vue fin novembre 2026", "pr&eacute;vue : fin novembre 2026.");
		const serve = (html: string) => (path: string) => (path.includes("clindamycine-600-mg") ? new Response(html) : undefined);
		await run({ detail: serve(before), answers: answers1566("fin octobre 2026") });
		const { res } = await run({ list: setUpdated(LIST_HTML, "1566", "27/10/2026"), detail: serve(after), answers: answers1566("fin novembre 2026") });
		expect(res.counts.entries_changed).toBe(1);
		expect(await history()).toEqual([
			expect.objectContaining({
				shortage_id: "1566",
				change_type: "return_date_change",
				old_expected_return: "Date de remise à disposition prévue fin octobre 2026.",
				new_expected_return: "Date de remise à disposition prévue : fin novembre 2026.",
			}),
		]);
	});

	it("writes no return_date_change when both wordings are undetermined", async () => {
		const { res } = await twoReturns(
			{ line: "Date de remise à disposition prévue indéterminée.", retour: "indéterminée" },
			{ line: "Date de remise à disposition indéterminée.", retour: "indéterminée" },
		);
		expect(await history()).toEqual([]);
		expect(res.counts.entries_changed).toBe(0);
	});

	it("writes no return_date_change when both wordings parse to the same window", async () => {
		const { res } = await twoReturns(
			{ line: "Remise à disposition prévue fin décembre 2026.", retour: "fin décembre 2026" },
			{ line: "Date de remise à disposition prévue : fin décembre 2026", retour: "fin décembre 2026" },
		);
		expect(await history()).toEqual([]);
		expect(res.counts.entries_changed).toBe(0);
		expect((await shortage("1566"))?.expected_return_raw).toBe("Date de remise à disposition prévue : fin décembre 2026");
	});

	it("records a return_date_change between two different unparsed wordings", async () => {
		const { res } = await twoReturns(
			{ line: "Remise à disposition prévue prochainement", retour: "prochainement" },
			{ line: "Remise à disposition prévue bientôt", retour: "bientôt" },
		);
		expect(res.counts.entries_changed).toBe(1);
		expect(await history()).toEqual([
			expect.objectContaining({
				change_type: "return_date_change",
				old_expected_return: "Remise à disposition prévue prochainement",
				new_expected_return: "Remise à disposition prévue bientôt",
			}),
		]);
	});

	it("records a return_date_change from no return line to an unparsed one", async () => {
		const { res } = await twoReturns(null, { line: "Remise à disposition prévue prochainement", retour: "prochainement" });
		expect(res.counts.entries_changed).toBe(1);
		expect(await history()).toEqual([
			expect.objectContaining({
				change_type: "return_date_change",
				old_expected_return: null,
				new_expected_return: "Remise à disposition prévue prochainement",
			}),
		]);
	});

	it("stores a dropped return line without a return_date_change and keeps it as lost", async () => {
		await run();
		const raw = (await shortage("1566"))?.expected_return_raw;
		const dropped = { list: setUpdated(LIST_HTML, "1566", "27/10/2026"), ...serveReturn(null) };
		let { res } = await run(dropped);
		expect(await history()).toEqual([]);
		expect(res.counts.entries_changed).toBe(0);
		const lostWindow = {
			expected_return_lost_raw: raw,
			expected_return_lost_earliest: "2026-11-01",
			expected_return_lost_latest: "2026-11-30",
			expected_return_lost_precision: "month",
			expected_return_lost_part: "fin",
		};
		expect(await shortage("1566")).toMatchObject({ expected_return_raw: null, expected_return_earliest: null, ...lostWindow });
		const lostLogs = logSpy.mock.calls.filter((c: unknown[]) => c[0] === JSON.stringify({ event: "return_lost", id: "1566" }));
		expect(lostLogs).toHaveLength(1);

		const again = await run(dropped);
		expect(detailCalls(again.f)).toEqual([]);
		expect(await shortage("1566")).toMatchObject(lostWindow);

		// A refetch that still has no return line keeps the lost window.
		await run({ ...dropped, list: setUpdated(LIST_HTML, "1566", "27/11/2026") });
		expect(await shortage("1566")).toMatchObject(lostWindow);

		({ res } = await run({
			list: setUpdated(LIST_HTML, "1566", "28/10/2026"),
			...serveReturn({ line: "Remise à disposition au niveau du/des laboratoires exploitants : fin novembre 2026.", retour: "fin novembre 2026" }),
		}));
		expect(await history()).toEqual([]);
		expect(res.counts.entries_changed).toBe(0);
		expect(await shortage("1566")).toMatchObject({
			expected_return_raw: "Remise à disposition au niveau du/des laboratoires exploitants : fin novembre 2026.",
			expected_return_lost_raw: null,
			expected_return_lost_earliest: null,
			expected_return_lost_latest: null,
			expected_return_lost_precision: null,
			expected_return_lost_part: null,
		});
	});

	it("records the lost text as the old value when a different return comes back", async () => {
		await run();
		const raw = (await shortage("1566"))?.expected_return_raw;
		await run({ list: setUpdated(LIST_HTML, "1566", "27/10/2026"), ...serveReturn(null) });
		const { res } = await run({
			list: setUpdated(LIST_HTML, "1566", "28/10/2026"),
			...serveReturn({ line: "Date de remise à disposition prévue fin décembre 2026", retour: "fin décembre 2026" }),
		});
		expect(res.counts.entries_changed).toBe(1);
		expect(await history()).toEqual([
			expect.objectContaining({
				change_type: "return_date_change",
				old_expected_return: raw,
				new_expected_return: "Date de remise à disposition prévue fin décembre 2026",
			}),
		]);
		expect((await shortage("1566"))?.expected_return_lost_raw).toBeNull();
	});

	it("records the lost text as the old value when the return comes back undetermined", async () => {
		await run();
		const raw = (await shortage("1566"))?.expected_return_raw;
		await run({ list: setUpdated(LIST_HTML, "1566", "27/10/2026"), ...serveReturn(null) });
		const { res } = await run({
			list: setUpdated(LIST_HTML, "1566", "28/10/2026"),
			...serveReturn({ line: "Date de remise à disposition prévue indéterminée.", retour: "indéterminée" }),
		});
		expect(res.counts.entries_changed).toBe(1);
		expect(await history()).toEqual([
			expect.objectContaining({
				change_type: "return_date_change",
				old_expected_return: raw,
				new_expected_return: "Date de remise à disposition prévue indéterminée.",
			}),
		]);
		expect((await shortage("1566"))?.expected_return_lost_raw).toBeNull();
	});

	it("writes no return_date_change between no return line and an undetermined one", async () => {
		await run(serveReturn(null));
		let { res } = await run({
			list: setUpdated(LIST_HTML, "1566", "27/10/2026"),
			...serveReturn({ line: "Date de remise à disposition prévue indéterminée.", retour: "indéterminée" }),
		});
		expect(res.counts.entries_changed).toBe(0);
		({ res } = await run({ list: setUpdated(LIST_HTML, "1566", "28/10/2026"), ...serveReturn(null) }));
		expect(res.counts.entries_changed).toBe(0);
		expect(await history()).toEqual([]);
		expect(await shortage("1566")).toMatchObject({ expected_return_raw: null, expected_return_lost_raw: null });
		expect(logSpy.mock.calls.some((c: unknown[]) => typeof c[0] === "string" && c[0].includes('"return_lost"'))).toBe(false);
	});

	it("clears the lost return when the status leaves rupture and tension", async () => {
		await run();
		await run({ list: setUpdated(LIST_HTML, "1566", "27/10/2026"), ...serveReturn(null) });
		expect((await shortage("1566"))?.expected_return_lost_raw).not.toBeNull();
		await run({ list: setLabel(setUpdated(LIST_HTML, "1566", "27/10/2026"), "1566", "Remise à disposition"), ...serveReturn(null) });
		expect(await shortage("1566")).toMatchObject({ expected_return_lost_raw: null, expected_return_lost_earliest: null, expected_return_lost_precision: null });
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
		const counted = queryCount();
		await run();
		expect(counted.queries()).toBeLessThanOrEqual(50);
	});
});

describe("return comparison by window", { timeout: 30_000 }, () => {
	it("records nothing when a stored row with no window is re-read with one", async () => {
		const line = "Date de remise à disposition prévue fin novembre 2026";
		await run({ answers: answers1566("") });
		expect(await shortage("1566")).toMatchObject({ expected_return_raw: line, expected_return_earliest: null });
		const { res } = await run({ list: setUpdated(LIST_HTML, "1566", "27/10/2026"), answers: answers1566("fin novembre 2026") });
		expect(res.counts.entries_changed).toBe(0);
		expect(await history()).toEqual([]);
		expect(await shortage("1566")).toMatchObject({ expected_return_raw: line, expected_return_earliest: "2026-11-01", expected_return_part: "fin" });
	});

	it("records nothing for the same window under the new-layout wording", async () => {
		const { res } = await twoReturns(
			{ line: "Date de remise à disposition prévue fin novembre 2026", retour: "fin novembre 2026" },
			{ line: "Remise à disposition au niveau du/des laboratoires exploitants : fin novembre 2026.", retour: "fin novembre 2026" },
		);
		expect(res.counts.entries_changed).toBe(0);
		expect(await history()).toEqual([]);
	});

	it("records nothing from indéterminée to inconnue", async () => {
		const { res } = await twoReturns(
			{ line: "Date de remise à disposition prévue indéterminée.", retour: "indéterminée" },
			{ line: "Date de remise à disposition normale inconnue", retour: "inconnue" },
		);
		expect(res.counts.entries_changed).toBe(0);
		expect(await history()).toEqual([]);
	});

	it("records a return_date_change for a different window", async () => {
		const { res } = await twoReturns(
			{ line: "Remise à disposition au niveau du/des laboratoires exploitants : fin novembre 2026.", retour: "fin novembre 2026" },
			{ line: "Remise à disposition au niveau du/des laboratoires exploitants : février 2027.", retour: "février 2027" },
		);
		expect(res.counts.entries_changed).toBe(1);
		expect(await history()).toEqual([
			expect.objectContaining({
				change_type: "return_date_change",
				old_expected_return: "Remise à disposition au niveau du/des laboratoires exploitants : fin novembre 2026.",
				new_expected_return: "Remise à disposition au niveau du/des laboratoires exploitants : février 2027.",
			}),
		]);
	});

	it("records a return_date_change when a dropped return comes back with a different window", async () => {
		await run();
		await run({ list: setUpdated(LIST_HTML, "1566", "27/10/2026"), ...serveReturn(null) });
		const { res } = await run({
			list: setUpdated(LIST_HTML, "1566", "28/10/2026"),
			...serveReturn({ line: "Remise à disposition au niveau du/des laboratoires exploitants : février 2027.", retour: "février 2027" }),
		});
		expect(res.counts.entries_changed).toBe(1);
		expect(await history()).toEqual([
			expect.objectContaining({
				change_type: "return_date_change",
				old_expected_return: "Date de remise à disposition prévue fin novembre 2026",
				new_expected_return: "Remise à disposition au niveau du/des laboratoires exploitants : février 2027.",
			}),
		]);
	});
});

describe("model extraction in the ingest", { timeout: 30_000 }, () => {
	const extractLogs = (): Array<{ id: string; reason: string }> =>
		logSpy.mock.calls
			.map((c: unknown[]) => c[0])
			.filter((l: unknown): l is string => typeof l === "string" && l.includes('"extract_failed"'))
			.map((l: string) => JSON.parse(l) as { id: string; reason: string });

	const extractedIds = async (): Promise<Set<string>> => {
		const rows = await env.DB.prepare("SELECT id FROM shortages WHERE status IN ('rupture', 'tension')").all<{ id: string }>();
		return new Set(rows.results.map((r) => r.id));
	};

	it("calls the model only for rupture and tension pages", async () => {
		const extract = stubExtract();
		const res = ran(await runIngest(env, fakeFetcher(), { ...OPTS, extract }));
		expect(res.status).toBe("ok");
		expect(new Set(extract.calls)).toEqual(await extractedIds());
		for (const id of ["1590", "1270"]) {
			expect(extract.calls).not.toContain(id);
			expect(await shortage(id)).toMatchObject({
				scope: "inconnu",
				scope_raw: null,
				expected_return_raw: null,
				expected_return_earliest: null,
				expected_return_latest: null,
				expected_return_precision: null,
				expected_return_part: null,
				detail_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
			});
		}
		expect(await shortage("1590")).toMatchObject({ situation_start: expect.any(String) });
	});

	it("keeps the stored values when the model call fails and retries next run", async () => {
		await run();
		const before = await shortage("1566");
		const list = setUpdated(LIST_HTML, "1566", "27/10/2026");
		const failing = stubExtract(FIXTURE_ANSWERS, async () => {
			throw new Error("JSON Mode couldn't be met");
		});
		const res = ran(await runIngest(env, fakeFetcher({ list }), { ...OPTS, extract: failing }));
		expect(res).toMatchObject({ status: "ok", message: "extract_failed=1; dispo=ok" });
		expect(await shortage("1566")).toMatchObject({
			detail_hash: null,
			scope: before?.scope,
			expected_return_raw: before?.expected_return_raw,
			expected_return_earliest: before?.expected_return_earliest,
			ansm_updated_at: "2026-10-27",
		});
		expect(extractLogs()).toEqual([{ event: "extract_failed", id: "1566", reason: "JSON Mode couldn't be met" }]);
		expect((await loadHealth(env.DB, new Date())).quality.detail_pending).toBe(1);
		expect(await history()).toEqual([]);

		const retry = await run({ list });
		expect(detailCalls(retry.f)).toEqual([expect.stringContaining("clindamycine-600-mg")]);
		expect((await shortage("1566"))?.detail_hash).toBe(before?.detail_hash);
	});

	it("starts no model call and fetches no rupture or tension page once the budget is spent", async () => {
		const fakeRun = vi.fn(async () => ({ response: NO_ANSWER }));
		const f = fakeFetcher();
		const res = ran(await runIngest(env, f, { ...OPTS, extract: stubExtract(FIXTURE_ANSWERS, fakeRun), extractBudgetMs: 0 }));
		const ids = await extractedIds();
		expect(res.status).toBe("ok");
		expect(fakeRun).not.toHaveBeenCalled();
		expect(res.message).toBe(`bootstrap; extract_failed=${ids.size}; dispo=ok`);
		expect(res.counts.entries_new).toBe(TOTAL);
		expect(res.detailsFetched).toBe(TOTAL - ids.size);
		expect(detailCalls(f)).toHaveLength(TOTAL - ids.size);
		expect(detailCalls(f)).not.toContainEqual(expect.stringContaining("clindamycine-600-mg"));
		const logs = extractLogs();
		expect(new Set(logs.map((l) => l.id))).toEqual(ids);
		for (const l of logs) expect(l.reason).toBe("budget");
		expect(await count("SELECT COUNT(*) AS n FROM shortages WHERE status IN ('rupture', 'tension') AND detail_hash IS NOT NULL")).toBe(0);
		expect(await count("SELECT COUNT(*) AS n FROM shortages WHERE status NOT IN ('rupture', 'tension') AND detail_hash IS NULL")).toBe(0);
	});

	it("times out a model call that never answers and keeps the run ok", async () => {
		const never = () => new Promise<never>(() => {});
		const res = ran(await runIngest(env, fakeFetcher(), { ...OPTS, extract: stubExtract(FIXTURE_ANSWERS, never), extractTimeoutMs: 5 }));
		const ids = await extractedIds();
		expect(res.status).toBe("ok");
		expect(res.message).toBe(`bootstrap; extract_failed=${ids.size}; dispo=ok`);
		const logs = extractLogs();
		expect(new Set(logs.map((l) => l.id))).toEqual(ids);
		for (const l of logs) expect(l.reason).toBe("timeout after 5 ms");
	});
});
