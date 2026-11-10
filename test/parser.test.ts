import { afterEach, describe, expect, it, vi } from "vitest";
import { type ListRow, parseDetail, parseList, parseScope, pickReturnLine, splitNameDci } from "../src/ingest/ansm";
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
		const d = await parseDetail(fixtureText("ansm/detail-1566.html"), "tension", "1566");
		expect(d).toMatchObject({
			situation_start: "2026-06-05",
			dci: "Clindamycine (phosphate de)",
		});
		expect(d.detail_hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("reads the situation start of a page without an update date", async () => {
		const d = await parseDetail(fixtureText("ansm/detail-rupture.html"), "rupture", "1625");
		expect(d).toMatchObject({ situation_start: "2026-10-26" });
	});

	it("returns a null DCI without a DCI block", async () => {
		const d = await parseDetail(fixtureText("ansm/detail-no-dci.html"), "tension", "1510");
		expect(d.dci).toBeNull();
	});

	it("1566 picks the 'prévue fin novembre 2026' line, not the other product's line", async () => {
		const d = await parseDetail(fixtureText("ansm/detail-1566.html"), "tension", "1566");
		expect(d).toMatchObject({
			expected_return_raw: "Date de remise à disposition prévue fin novembre 2026",
			expected_return_earliest: "2026-11-01",
			expected_return_latest: "2026-11-30",
			expected_return_precision: "month",
			expected_return_part: "fin",
		});
	});

	it("880 picks nothing (export-ban paragraph only)", async () => {
		const d = await parseDetail(fixtureText("ansm/detail-880.html"), "tension", "880");
		expect(d).toMatchObject({
			expected_return_raw: null,
			expected_return_earliest: null,
			expected_return_latest: null,
			expected_return_precision: null,
			expected_return_part: null,
		});
	});

	it("parses the return line of rupture and tension pages", async () => {
		expect(await parseDetail(fixtureText("ansm/detail-rupture.html"), "rupture", "1625")).toMatchObject({
			expected_return_raw: "Date de remise à disposition prévue courant 2027.",
			expected_return_precision: "year",
		});
		expect(await parseDetail(fixtureText("ansm/detail-tension.html"), "tension", "1624")).toMatchObject({
			expected_return_raw: "Date de remise à disposition prévue début décembre 2026.",
			expected_return_earliest: "2026-12-01",
			expected_return_part: "debut",
		});
	});

	it("keeps no return line for other statuses", async () => {
		for (const [f, st] of [
			["ansm/detail-remise.html", "remise_a_disposition"],
			["ansm/detail-arret.html", "arret_commercialisation"],
		] as const) {
			const d = await parseDetail(fixtureText(f), st, "x");
			expect(d.expected_return_raw).toBeNull();
			expect(d.expected_return_earliest).toBeNull();
		}
	});

	it("reads the scope lines of the fixtures", async () => {
		expect(await parseDetail(fixtureText("ansm/detail-rupture.html"), "rupture", "1625")).toMatchObject({
			scope: "hopital",
			scope_raw: "Situation à l'hôpital : rupture ;",
		});
		expect(await parseDetail(fixtureText("ansm/detail-tension.html"), "tension", "1624")).toMatchObject({
			scope: "ville",
			scope_raw: "Situation en ville : tension ;",
		});
		expect(await parseDetail(fixtureText("ansm/detail-no-situation.html"), "rupture", "256")).toMatchObject({
			scope: "inconnu",
			scope_raw: null,
		});
		expect(await parseDetail(fixtureText("ansm/detail-880.html"), "tension", "880")).toMatchObject({
			scope: "ville",
			scope_raw: "Distribution contingentée en ville de la présentation en flacon de 60 gélules",
		});
	});

	it("256 falls back to its normale line and logs return_unparsed", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const d = await parseDetail(fixtureText("ansm/detail-no-situation.html"), "rupture", "256");
		expect(d.expected_return_raw).toBe("Date de remise à disposition normale inconnue");
		expect(d.expected_return_earliest).toBeNull();
		expect(spy).toHaveBeenCalledWith(JSON.stringify({ event: "return_unparsed", id: "256" }));
	});

	it("logs return_unparsed for a revient line without a date", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const html = `<div class="panel-fuschia"><div class="products-block"><ul><li>L'ampoule est en rupture et revient prochainement</li></ul></div></div>`;
		const d = await parseDetail(html, "tension", "43");
		expect(d.expected_return_raw).toBe("L'ampoule est en rupture et revient prochainement");
		expect(d.expected_return_earliest).toBeNull();
		expect(spy).toHaveBeenCalledWith(JSON.stringify({ event: "return_unparsed", id: "43" }));
	});

	it("logs return_unparsed when a picked line yields no date", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const html = `<div class="panel-fuschia"><div class="products-block"><ul><li>Date de remise &agrave; disposition pr&eacute;vue prochainement</li></ul></div></div>`;
		const d = await parseDetail(html, "rupture", "42");
		expect(d.expected_return_raw).toBe("Date de remise à disposition prévue prochainement");
		expect(spy).toHaveBeenCalledWith(JSON.stringify({ event: "return_unparsed", id: "42" }));
	});

	it("941 reads the free-text tension line and the revient return line", async () => {
		const html = `<div class="panel-fuschia"><div class="products-block"><ul><li>Tension d'approvisionnement en ville ;</li>
<li>L'ampoule de 2 ml est en rupture et revient fin d&eacute;cembre 2026.</li></ul></div></div>`;
		expect(await parseDetail(html, "tension", "941")).toMatchObject({
			scope: "ville",
			scope_raw: "Tension d'approvisionnement en ville ;",
			expected_return_raw: "L'ampoule de 2 ml est en rupture et revient fin décembre 2026.",
			expected_return_earliest: "2026-12-01",
			expected_return_latest: "2026-12-31",
			expected_return_precision: "month",
			expected_return_part: "fin",
		});
	});

	it("does not log return_unparsed for an indeterminate line", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const d = await parseDetail(fixtureText("ansm/detail-no-dci.html"), "tension", "1510");
		expect(d.expected_return_raw).toBe("Date de remise à disposition indéterminée");
		expect(spy).not.toHaveBeenCalled();
	});

	it("stores no observation text other than the scope and return lines", async () => {
		const d = await parseDetail(fixtureText("ansm/detail-1566.html"), "tension", "1566");
		expect(JSON.stringify(d)).not.toContain("Kalceks");
		expect(JSON.stringify(d)).not.toContain("Kabi");
	});
});

describe("parseScope", () => {
	const H = "Situation à l'hôpital :";
	const V = "Situation en ville :";

	it("combines both sides", () => {
		expect(parseScope([`${V} rupture`, `${H} tension`])).toEqual({ scope: "ville_hopital", scope_raw: `${V} rupture | ${H} tension` });
		expect(parseScope([`${V} non impacté`, `${H} rupture`]).scope).toBe("hopital");
		expect(parseScope([`${V} tension`, `${H} non impactée`]).scope).toBe("ville");
	});

	it("gives NON IMPACTE precedence over rupture/tension", () => {
		expect(parseScope([`${V} non impacté (rupture levée)`, `${H} non impacté`]).scope).toBe("inconnu");
	});

	it("accepts the typographic apostrophe and the grossistes variant", () => {
		expect(parseScope(["Situation à l’hôpital : rupture"]).scope).toBe("hopital");
		expect(parseScope(["Situation en ville (unités professionnelles - grossistes) : tension"]).scope).toBe("ville");
	});

	it("yields ville on a ville-only page and shows the hôpital side was not stated", () => {
		expect(parseScope(["Autre ligne", `${V} rupture`])).toEqual({ scope: "ville", scope_raw: `${V} rupture` });
	});

	it("returns inconnu without a scope line", () => {
		expect(parseScope(["Rupture de stock"])).toEqual({ scope: "inconnu", scope_raw: null });
	});

	it("reads a free-text <head> <side> line when there is no Situation line", () => {
		const l891 = "Tension d’approvisionnement en ville pour tous les dosages";
		expect(parseScope([l891])).toEqual({ scope: "ville", scope_raw: l891 });
		expect(parseScope(["Distribution contingentée en ville", "Distribution normale à l'hôpital"])).toEqual({
			scope: "ville",
			scope_raw: "Distribution contingentée en ville",
		});
		expect(parseScope(["Contingentement quantitatif à l'hôpital."])).toEqual({
			scope: "hopital",
			scope_raw: "Contingentement quantitatif à l'hôpital.",
		});
	});

	it("unions the sides of free-text lines", () => {
		expect(parseScope(["Rupture de stock en ville et à l'hôpital"]).scope).toBe("ville_hopital");
		expect(parseScope(["Tension d'approvisionnement à l'hôpital et en ville"]).scope).toBe("ville_hopital");
		expect(parseScope(["Tension d'approvisionnement en ville ;", "Contingentement quantitatif à l'hôpital."])).toEqual({
			scope: "ville_hopital",
			scope_raw: "Tension d'approvisionnement en ville ; | Contingentement quantitatif à l'hôpital.",
		});
	});

	it("rejects free-text lines that are not <head> <side>", () => {
		for (const line of [
			"Tension d'approvisionnement en Eurobiol 40 000 U, gélule gastro-résistante (flacon de 50)",
			"Distribution contingentée sur le marché de ville ;",
			"Boite de 1: contingentement quantitatif en ville",
			"Le circuit hospitalier ainsi que les DROM ne sont pas impactés par ces mesures.",
			"Disponibilité d'un stock limité de dépannage d'urgence à l'hôpital ;",
			"Tension d’approvisionnement concernant la présentation en boîte de 60 gélules (plaquettes thermoformées) : distribution contingentée à l’hôpital et report possible sur la présentation en flacon de 60 gélules",
		]) {
			expect(parseScope([line])).toEqual({ scope: "inconnu", scope_raw: null });
		}
	});

	it("ignores free-text lines when a Situation line exists", () => {
		expect(parseScope([`${V} tension`, "Contingentement quantitatif en ville"])).toEqual({ scope: "ville", scope_raw: `${V} tension` });
		expect(parseScope([`${V} non impacté`, `${H} non impacté`, "Tension d'approvisionnement en ville"]).scope).toBe("inconnu");
	});
});

describe("pickReturnLine", () => {
	it("drops DE LA SPECIALITE lines and falls back to a normale line", () => {
		expect(
			pickReturnLine([
				"Remise à disposition normale de la spécialité X",
				"Remise à disposition de la spécialité Y prévue fin 2026",
				"Date de remise à disposition normale inconnue",
			]),
		).toBe("Date de remise à disposition normale inconnue");
		expect(pickReturnLine(["Remise à disposition normale de la spécialité X"])).toBeNull();
	});

	it("falls back to a normale remise line", () => {
		expect(
			pickReturnLine(["Situation en ville : tension ;", "Contingentement quantitatif en ville ;", "Remise à disposition normale prévue courant décembre 2026."]),
		).toBe("Remise à disposition normale prévue courant décembre 2026.");
		expect(
			pickReturnLine([
				"Tension d’approvisionnement en ville pour tous les dosages",
				"Mise en place d’un contingentement quantitatif en ville",
				"Les hôpitaux et les DROM ne sont pas impactés par ce contingentement",
				"Remise à disposition normale indéterminée",
			]),
		).toBe("Remise à disposition normale indéterminée");
		expect(
			pickReturnLine([
				"Rupture de stock de la présentation en flacon de 10 ml de Méthotrexate Accord 100 mg/mL, solution à diluer pour perfusion ;",
				"Remise à disposition normale indéterminée de la présentation en flacon de 10 ml ;",
				"Remise à disposition normale de la présentation en flacon de 50 ml à compter de fin novembre 2024.",
			]),
		).toBe("Remise à disposition normale indéterminée de la présentation en flacon de 10 ml ;");
	});

	it("falls back to a revient line, whole word only", () => {
		const revient = "L'ampoule de 2 ml est en rupture et revient fin décembre 2026.";
		expect(pickReturnLine(["Tension d'approvisionnement en ville ;", revient])).toBe(revient);
		expect(pickReturnLine(["Date de remise à disposition prévue fin 2026", revient])).toBe("Date de remise à disposition prévue fin 2026");
		expect(pickReturnLine(["Le produit reviendra en 2027"])).toBeNull();
		expect(
			pickReturnLine(["Rupture de stock de l’Héparine Calcique Panpharma …, avec remise à disposition prévue en octobre 2024."]),
		).toBeNull();
	});

	it("tries the remise, normale and revient tiers in order", () => {
		const normale = "Remise à disposition normale prévue fin 2026";
		expect(pickReturnLine(["Remise à disposition du conditionnement en boite de 20 : indéterminée.", normale])).toBe(
			"Remise à disposition du conditionnement en boite de 20 : indéterminée.",
		);
		expect(pickReturnLine([normale, "Date de remise à disposition prévue fin novembre 2026"])).toBe("Date de remise à disposition prévue fin novembre 2026");
		expect(pickReturnLine(["L'ampoule de 2 ml est en rupture et revient fin décembre 2026.", normale])).toBe(normale);
	});

	it("prefers a page-level line over a per-pack line", () => {
		const perPack = "Remise à disposition du conditionnement en boite de 20 : indéterminée.";
		const page = "Date de remise à disposition prévue, au mieux, fin 2026";
		expect(pickReturnLine([perPack, page])).toBe(page);
		expect(pickReturnLine(["Remise à disposition de la présentation en flacon : fin 2026", perPack])).toBe(
			"Remise à disposition de la présentation en flacon : fin 2026",
		);
	});

	it("accepts the known real line shapes", () => {
		for (const line of [
			"Date de remise à disposition prévue : fin 2026",
			"Date de remise à disposition au niveau des laboratoires exploitants : fin novembre 2026",
			"Remise à disposition prévue indéterminée",
		]) {
			expect(pickReturnLine(["Autre", ` ${line} `])).toBe(line);
		}
	});
});
