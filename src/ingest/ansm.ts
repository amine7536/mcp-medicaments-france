import { parseFrDate } from "../lib/dates";
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

/** ANSM's trailing "updated" marker, optionally followed by `*`. */
const MAJ_MARKER = /\s+\[MAJ\]\s*\*?\s*$/i;

/** Splits `Name – [DCI]` at the last ` – [` / ` - [` separator, after dropping a trailing ` [MAJ]` marker. */
export function splitNameDci(input: string): { raw_name: string; dci_raw: string | null } {
	const cell = input.replace(MAJ_MARKER, "");
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

/** The deterministic fields of an ANSM detail page and its cleaned observation lines, in page order. */
export interface DetailPage {
	situation_start: string | null;
	dci: string | null;
	observations: string[];
}

/** Parses an ANSM detail page. */
export async function parseDetail(html: string): Promise<DetailPage> {
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

	return {
		situation_start: parseFrDate(clean(period).replace(/^au\s+/i, "")),
		dci,
		observations: lis.map(clean).filter((li) => li !== ""),
	};
}
