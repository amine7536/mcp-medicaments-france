import { afterEach, describe, expect, it, vi } from "vitest";
import { type ListRow, parseDetail, parseList, splitNameDci } from "../src/ingest/ansm";
import { fixtureText, LIST_HTML } from "./fixtures";

const remiseCell = (b: string, dataValue = "2026/10/27"): string => `<td data-value="${dataValue}">\n  <b>${b}</b>\n</td>`;

async function one(cells: string[]): Promise<ListRow> {
	const html = `<table><tbody><tr class="product-item" data-id="1" data-href="/x"><td>${cells[0]}</td><td>${cells[1]}</td><td>${cells[2]}</td>${remiseCell(cells[3] ?? "")}<td>${cells[4]}</td></tr></tbody></table>`;
	const rows = await parseList(html);
	expect(rows).toHaveLength(1);
	return rows[0] as ListRow;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("parseList on the list fixture", async () => {
	const rows = await parseList(LIST_HTML);
	const byId = new Map(rows.map((r) => [r.id, r]));

	it("returns one row per tr.product-item, none autre, every row named and dated", () => {
		const expected = LIST_HTML.match(/<tr class="product-item"/g)?.length;
		expect(rows).toHaveLength(expected as number);
		expect(rows.length).toBeGreaterThanOrEqual(200);
		expect(rows.filter((r) => r.status === "autre")).toEqual([]);
		for (const r of rows) {
			expect(r.raw_name).not.toBe("");
			expect(r.ansm_updated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(r.ansm_path).toMatch(/^\/disponibilites-des-produits-de-sante\/medicaments\//);
			expect(r.list_hash).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	it("maps every status label", () => {
		expect(byId.get("1625")).toMatchObject({ status: "rupture", status_raw: "Rupture de stock" });
		expect(byId.get("1624")).toMatchObject({ status: "tension", status_raw: "Tension d'approvisionnement" });
		expect(byId.get("1590")).toMatchObject({ status: "remise_a_disposition", status_raw: "Remise à disposition" });
		expect(byId.get("1270")).toMatchObject({ status: "arret_commercialisation", status_raw: "Arrêt de commercialisation" });
	});

	it("splits on ' – [' and ' - [' and keeps the id and path", () => {
		expect(byId.get("1566")).toMatchObject({
			ansm_path: "/disponibilites-des-produits-de-sante/medicaments/clindamycine-600-mg-4ml-solution-injectable-clindamycine-phosphate-de",
			raw_name: "Clindamycine 600 mg/4ml, solution injectable",
			dci_raw: "clindamycine (phosphate de)",
			ansm_updated_at: "2026-10-26",
			therapeutic_areas: "Infectiologie",
			therapeutic_areas_norm: "INFECTIOLOGIE",
		});
		expect(byId.get("1623")?.dci_raw).toBe("acide glutamique...magnésium (lactate de)");
		expect(byId.get("1623")?.raw_name).toBe("Pediaven AP-HP G15, solution pour perfusion");
	});

	it("handles rows without brackets", () => {
		expect(byId.get("934")).toMatchObject({
			raw_name: "Kanokad 25 UI/mL de facteur IX, poudre et solvant pour solution injectable – Flacon de 250 UI (10 ml) et de 500 UI (20 ml)",
			dci_raw: null,
		});
		expect(byId.get("256")).toMatchObject({ raw_name: "SEMAP 20 mg , comprimé", dci_raw: null });
		expect(byId.get("1240")?.dci_raw).toBeNull();
	});

	it("keeps nested brackets and trims a leading space in the DCI", () => {
		expect(byId.get("1424")?.dci_raw).toBe("6-iodométhylnorcholestérol [131 I]");
		expect(byId.get("1128")?.dci_raw).toBe("quétiapine (fumarate de)");
	});

	it("reads names wrapped in <b>", () => {
		expect(byId.get("880")).toMatchObject({ raw_name: "Creon 25 000 U, gélule gastrorésistante", dci_raw: "pancréatine" });
		expect(byId.get("313")).toMatchObject({
			raw_name: "Actosolv 100 000 UI et 600 000 UI, poudre pour solution injectable / pour perfusion",
			dci_raw: "Urokinase",
		});
	});

	it("reads the return date from <b> only on remise rows", () => {
		expect(byId.get("1590")?.returned_at).toBe("2026-10-21");
		expect(byId.get("1625")?.returned_at).toBeNull();
	});
});

describe("parseList on synthetic rows", () => {
	it("decodes entities and collapses whitespace", async () => {
		const r = await one(["Tension d&#039;approvisionnement", " 01/02/2026 ", "A &amp; B\n   &eacute;  – [x&nbsp;y]", "", "Cardiologie, Neurologie"]);
		expect(r).toMatchObject({
			status: "tension",
			status_raw: "Tension d'approvisionnement",
			raw_name: "A & B é",
			dci_raw: "x y",
			ansm_updated_at: "2026-02-01",
			therapeutic_areas: "Cardiologie, Neurologie",
			therapeutic_areas_norm: "CARDIOLOGIE NEUROLOGIE",
		});
	});

	it("ignores case and apostrophe style in labels", async () => {
		expect((await one(["TENSION D’APPROVISIONNEMENT", "01/02/2026", "A", "", ""])).status).toBe("tension");
	});

	it("maps unknown labels to autre and logs them", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		expect((await one(["Nouveau statut", "01/02/2026", "A", "", ""])).status).toBe("autre");
		expect(spy).toHaveBeenCalledWith(JSON.stringify({ event: "unknown_status", label: "Nouveau statut" }));
	});

	it("leaves returned_at null on an empty Remise cell, ignoring data-value", async () => {
		const r = await one(["Remise à disposition", "01/02/2026", "A – [b]", "", ""]);
		expect(r.returned_at).toBeNull();
	});

	it("strips a trailing * and exactly one ]", async () => {
		expect(splitNameDci("Name* – [dci]*")).toEqual({ raw_name: "Name", dci_raw: "dci" });
		expect(splitNameDci("Name – [a [b]]")).toEqual({ raw_name: "Name", dci_raw: "a [b]" });
		expect(splitNameDci("Name*")).toEqual({ raw_name: "Name", dci_raw: null });
	});

	it("drops a trailing [MAJ] marker before splitting", () => {
		expect(splitNameDci("Tibéral 1 g, solution injectable pour perfusion – [ornidazole] [MAJ]")).toEqual({
			raw_name: "Tibéral 1 g, solution injectable pour perfusion",
			dci_raw: "ornidazole",
		});
		expect(splitNameDci("Pediaven AP-HP G15, solution pour perfusion - [acide glutamique...magnésium (lactate de)] [MAJ] *")).toEqual({
			raw_name: "Pediaven AP-HP G15, solution pour perfusion",
			dci_raw: "acide glutamique...magnésium (lactate de)",
		});
		expect(splitNameDci("Name – [a [b]] [maj]")).toEqual({ raw_name: "Name", dci_raw: "a [b]" });
		expect(splitNameDci("Name [MAJ]")).toEqual({ raw_name: "Name", dci_raw: null });
	});

	it("hashes the list cells", async () => {
		const a = await one(["Rupture de stock", "01/02/2026", "A", "", "X"]);
		const b = await one(["Rupture de stock", "02/02/2026", "A", "", "X"]);
		expect(a.list_hash).not.toBe(b.list_hash);
	});
});

describe("parseDetail", () => {
	it("reads the period and the DCI block", async () => {
		const d = await parseDetail(fixtureText("ansm/detail-1566.html"));
		expect(d).toMatchObject({ situation_start: "2026-06-05", dci: "Clindamycine (phosphate de)" });
	});

	it("reads the situation start of a page without an update date", async () => {
		expect((await parseDetail(fixtureText("ansm/detail-rupture.html"))).situation_start).toBe("2026-10-26");
	});

	it("returns a null DCI without a DCI block", async () => {
		expect((await parseDetail(fixtureText("ansm/detail-no-dci.html"))).dci).toBeNull();
	});

	it("returns the cleaned observation lines in page order", async () => {
		expect((await parseDetail(fixtureText("ansm/detail-rupture.html"))).observations).toEqual([
			"Situation à l'hôpital : rupture ;",
			expect.stringMatching(/^Mise à disposition exceptionnelle et transitoire d’unités de la spécialité Brevibloc/),
			"Date de remise à disposition prévue courant 2027.",
		]);
		expect((await parseDetail(fixtureText("ansm/detail-tension.html"))).observations).toEqual([
			"Situation en ville : tension ;",
			"Contingentement quantitatif en ville ;",
			"Disponibilité d'un stock limité de dépannage d'urgence en ville ;",
			"Date de remise à disposition prévue début décembre 2026.",
		]);
		expect((await parseDetail(fixtureText("ansm/detail-no-situation.html"))).observations).toEqual([
			"Rupture de stock",
			expect.stringMatching(/^Mise à disposition exceptionnelle par ACE Pharmaceuticals BV/),
			"Date de remise à disposition normale inconnue",
		]);
	});

	it("reads the new-layout situation panel of 1376", async () => {
		const d = await parseDetail(fixtureText("ansm/detail-1376.html"));
		expect(d.observations.slice(0, 4)).toEqual([
			"À l’hôpital : rupture ;",
			"En ville : non concerné ;",
			"Causes : augmentation du volume de vente ;",
			"Remise à disposition au niveau du/des laboratoires exploitants : fin novembre 2026.",
		]);
		expect(d.observations).toHaveLength(5);
		expect(d.observations.join("\n")).not.toContain("Un délai de quelques jours");
	});

	it("collects nested list items once each and drops empty ones", async () => {
		const html = `<div class="panel-fuschia"><div class="products-block"><ul><li>  A &amp; B <ul><li>C</li></ul></li><li> </li></ul></div></div>`;
		expect((await parseDetail(html)).observations).toEqual(["A & B", "C"]);
	});

	it("returns no observation without the panel", async () => {
		expect(await parseDetail("<html></html>")).toEqual({ situation_start: null, dci: null, observations: [] });
	});
});
