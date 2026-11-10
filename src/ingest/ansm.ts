import { type ExpectedReturn, isUndetermined, parseExpectedReturn, parseFrDate } from "../lib/dates";
import { sha256Hex } from "../lib/hash";
import { consume } from "../lib/html";
import { decodeHTML } from "entities/decode";
import { normalize } from "../lib/normalize";
import { log } from "./http";

export const STATUSES = ["rupture", "tension", "arret_commercialisation", "remise_a_disposition", "autre"] as const;
export type Status = (typeof STATUSES)[number];

export interface ListRow {
	id: string;
	ansm_path: string;
	raw_name: string;
	raw_name_norm: string;
	dci_raw: string | null;
	status: Status;
	status_raw: string;
	ansm_updated_at: string | null;
	returned_at: string | null;
	therapeutic_areas: string;
	therapeutic_areas_norm: string;
	list_hash: string;
}

export const SCOPES = ["ville", "hopital", "ville_hopital", "inconnu"] as const;
export type Scope = (typeof SCOPES)[number];

export interface DetailFields {
	situation_start: string | null;
	dci: string | null;
	scope: Scope;
	scope_raw: string | null;
	expected_return_earliest: string | null;
	expected_return_latest: string | null;
	expected_return_precision: string | null;
	expected_return_part: string | null;
	expected_return_raw: string | null;
}

export interface Detail extends DetailFields {
	detail_hash: string;
}

const STATUS_BY_LABEL: Record<string, Status> = {
	"rupture de stock": "rupture",
	"tension d'approvisionnement": "tension",
	"remise à disposition": "remise_a_disposition",
	"arrêt de commercialisation": "arret_commercialisation",
};

function clean(s: string): string {
	return decodeHTML(s).replace(/\s+/g, " ").trim();
}

function mapStatus(label: string): Status {
	return STATUS_BY_LABEL[label.replace(/[’‘]/g, "'").toLowerCase()] ?? "autre";
}

/** Splits `Name – [DCI]` at the last ` – [` / ` - [` separator. */
export function splitNameDci(cell: string): { raw_name: string; dci_raw: string | null } {
	const matches = [...cell.matchAll(/\s[–-]\s\[/g)];
	const last = matches.at(-1);
	if (last === undefined) return { raw_name: cell.replace(/\*+$/, "").trim(), dci_raw: null };
	const raw_name = cell.slice(0, last.index).replace(/[\s*]+$/, "");
	let dci = cell.slice(last.index + last[0].length).replace(/\*$/, "");
	if (dci.endsWith("]")) dci = dci.slice(0, -1);
	return { raw_name, dci_raw: dci.trim() };
}

/** Parses the ANSM list page into one row per `tr.product-item`. */
export async function parseList(html: string): Promise<ListRow[]> {
	interface RawRow {
		id: string;
		href: string;
		cells: string[];
		bold: string;
	}
	const raws: RawRow[] = [];
	let current: RawRow | null = null;

	await consume(
		new HTMLRewriter()
			.on("tr.product-item", {
				element(el) {
					const row: RawRow = { id: el.getAttribute("data-id") ?? "", href: el.getAttribute("data-href") ?? "", cells: [], bold: "" };
					current = row;
					el.onEndTag(() => {
						raws.push(row);
						current = null;
					});
				},
			})
			.on("tr.product-item > td", {
				element() {
					current?.cells.push("");
				},
				text(chunk) {
					if (current === null || current.cells.length === 0) return;
					current.cells[current.cells.length - 1] += chunk.text;
				},
			})
			.on("tr.product-item > td:nth-child(4) b", {
				text(chunk) {
					if (current !== null) current.bold += chunk.text;
				},
			}),
		html,
	);

	return Promise.all(
		raws.map(async (raw) => {
			const [c1 = "", c2 = "", c3 = "", , c5 = ""] = raw.cells.map(clean);
			const c4 = clean(raw.bold);
			const status = mapStatus(c1);
			if (status === "autre") log("unknown_status", { label: c1 });
			const { raw_name, dci_raw } = splitNameDci(c3);
			return {
				id: raw.id,
				ansm_path: raw.href,
				raw_name,
				raw_name_norm: normalize(raw_name),
				dci_raw,
				status,
				status_raw: c1,
				ansm_updated_at: parseFrDate(c2),
				returned_at: status === "remise_a_disposition" ? parseFrDate(c4) : null,
				therapeutic_areas: c5,
				therapeutic_areas_norm: normalize(c5),
				list_hash: await sha256Hex(JSON.stringify([c1, c2, c3, c4, c5])),
			};
		}),
	);
}

const SCOPE_HEADS = ["RUPTURE DE STOCK", "RUPTURE", "TENSION D APPROVISIONNEMENT", "DISTRIBUTION CONTINGENTEE", "CONTINGENTEMENT QUANTITATIF"];
const SCOPE_SIDES: Array<[string, { ville: boolean; hopital: boolean }]> = [
	["EN VILLE ET A L HOPITAL", { ville: true, hopital: true }],
	["A L HOPITAL ET EN VILLE", { ville: true, hopital: true }],
	["EN VILLE", { ville: true, hopital: false }],
	["A L HOPITAL", { ville: false, hopital: true }],
];

/** Sides stated by a free-text `<head> <side>` line ("Tension d'approvisionnement en ville ;"), or null. */
function freeTextSides(t: string): { ville: boolean; hopital: boolean } | null {
	for (const head of SCOPE_HEADS) {
		if (!t.startsWith(`${head} `)) continue;
		const rest = t.slice(head.length + 1);
		for (const [side, sides] of SCOPE_SIDES) {
			if (rest === side || rest.startsWith(`${side} `)) return sides;
		}
	}
	return null;
}

/**
 * Derives the impacted side(s) from the `Situation en ville / à l'hôpital :` observation lines,
 * or, when the page has none, from free-text `<head> <side>` lines.
 */
export function parseScope(lis: string[]): { scope: Scope; scope_raw: string | null } {
	const raw: string[] = [];
	const impacted = { ville: false, hopital: false };
	for (const li of lis) {
		const t = normalize(li);
		const side = t.startsWith("SITUATION EN VILLE") ? "ville" : t.startsWith("SITUATION A L HOPITAL") ? "hopital" : null;
		if (side === null) continue;
		raw.push(li);
		const colon = li.indexOf(":");
		const value = colon === -1 ? "" : normalize(li.slice(colon + 1));
		if (value.includes("NON IMPACTE")) continue;
		if (value.includes("RUPTURE") || value.includes("TENSION")) impacted[side] = true;
	}
	if (raw.length === 0) {
		for (const li of lis) {
			const sides = freeTextSides(normalize(li));
			if (sides === null) continue;
			raw.push(li);
			impacted.ville ||= sides.ville;
			impacted.hopital ||= sides.hopital;
		}
	}
	const scope: Scope =
		impacted.ville && impacted.hopital ? "ville_hopital" : impacted.ville ? "ville" : impacted.hopital ? "hopital" : "inconnu";
	return { scope, scope_raw: raw.length > 0 ? raw.join(" | ") : null };
}

const isRemiseLine = (t: string): boolean =>
	(t.startsWith("DATE DE REMISE A DISPOSITION") || t.startsWith("REMISE A DISPOSITION")) && !t.includes("DE LA SPECIALITE");

/** A page-level line (not about one pack or presentation) when there is one, else the first. */
function preferPageLevel(lines: string[]): string | undefined {
	const pageLevel = lines.find((li) => {
		const t = normalize(li);
		return !t.includes("CONDITIONNEMENT") && !t.includes("PRESENTATION");
	});
	return pageLevel ?? lines[0];
}

/**
 * Picks the observation line giving this entry's expected return, or null: a remise line, else a
 * "remise à disposition normale" line, else the first line containing the word "revient".
 */
export function pickReturnLine(lis: string[]): string | null {
	const remise = lis.filter((li) => isRemiseLine(normalize(li)));
	const line =
		preferPageLevel(remise.filter((li) => !normalize(li).includes("NORMALE"))) ??
		preferPageLevel(remise.filter((li) => normalize(li).includes("NORMALE"))) ??
		lis.find((li) => /(?:^| )REVIENT(?: |$)/.test(normalize(li)));
	return line?.trim() ?? null;
}

/** Parses an ANSM detail page. `status` is the entry's list status; `id` is used for logging. */
export async function parseDetail(html: string, status: Status, id: string): Promise<Detail> {
	let period = "";
	let dci: string | null = null;
	let title = "";
	let lastTitle = "";
	let content: string | null = null;
	const lis: string[] = [];
	const open: number[] = [];

	await consume(
		new HTMLRewriter()
			.on("span.period", {
				text(chunk) {
					period += chunk.text;
				},
			})
			.on("div.table-products-desc > h3.title", {
				element(el) {
					title = "";
					el.onEndTag(() => {
						lastTitle = clean(title);
					});
				},
				text(chunk) {
					title += chunk.text;
				},
			})
			.on("div.table-products-desc > div.content", {
				element(el) {
					const isDci = lastTitle === "DCI";
					content = "";
					el.onEndTag(() => {
						if (isDci && dci === null) dci = clean(content ?? "") || null;
						content = null;
					});
				},
				text(chunk) {
					if (content !== null) content += chunk.text;
				},
			})
			.on("div.panel-fuschia div.products-block li", {
				element(el) {
					open.push(lis.length);
					lis.push("");
					el.onEndTag(() => {
						open.pop();
					});
				},
				text(chunk) {
					const idx = open.at(-1);
					if (idx !== undefined) lis[idx] += chunk.text;
				},
			}),
		html,
	);

	const observations = lis.map(clean).filter((li) => li !== "");
	const { scope, scope_raw } = parseScope(observations);

	let expected: ExpectedReturn = { earliest: null, latest: null, precision: null, part: null };
	let expected_return_raw: string | null = null;
	if (status === "rupture" || status === "tension") {
		const line = pickReturnLine(observations);
		if (line !== null) {
			expected_return_raw = line;
			expected = parseExpectedReturn(line);
			if (expected.earliest === null && !isUndetermined(line)) log("return_unparsed", { id });
		}
	}

	const fields: DetailFields = {
		situation_start: parseFrDate(clean(period).replace(/^au\s+/i, "")),
		dci,
		scope,
		scope_raw,
		expected_return_earliest: expected.earliest,
		expected_return_latest: expected.latest,
		expected_return_precision: expected.precision,
		expected_return_part: expected.part,
		expected_return_raw,
	};
	return { ...fields, detail_hash: await sha256Hex(JSON.stringify(fields)) };
}
