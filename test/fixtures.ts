import { env } from "cloudflare:workers";
import { ANSM_LIST_URL, ANSM_ORIGIN, DISPO_URL, type Fetcher } from "../src/ingest/http";

/** Raw bytes of `test/fixtures/<path>`. */
export function fixtureBytes(path: string): Uint8Array {
	const b64 = env.TEST_FIXTURES[path];
	if (b64 === undefined) throw new Error(`missing fixture ${path}`);
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function fixtureText(path: string): string {
	return new TextDecoder().decode(fixtureBytes(path));
}

export const LIST_HTML = fixtureText("ansm/list.html");

/** Detail fixture per ANSM list id. */
export const DETAIL_BY_ID: Record<string, string> = {
	"1566": "ansm/detail-1566.html",
	"880": "ansm/detail-880.html",
	"1625": "ansm/detail-rupture.html",
	"1624": "ansm/detail-tension.html",
	"1590": "ansm/detail-remise.html",
	"1270": "ansm/detail-arret.html",
	"1510": "ansm/detail-no-dci.html",
	"256": "ansm/detail-no-situation.html",
};

export interface FakeFetcher extends Fetcher {
	calls: string[];
}

export interface FakeOptions {
	list?: string | (() => Response);
	dispo?: Uint8Array | (() => Response);
	/** Detail response per path; defaults to a fixture by id, else `detail-tension.html`. */
	detail?: (path: string) => Response | undefined;
}

/** A fetcher serving fixtures for the ANSM list, ANSM detail pages and the BDPM shortage file. */
export function fakeFetcher(opts: FakeOptions = {}): FakeFetcher {
	const pathToFixture = new Map<string, string>();
	for (const m of LIST_HTML.matchAll(/data-id="(\d+)"\s+data-href="([^"]+)"/g)) {
		pathToFixture.set(m[2] as string, DETAIL_BY_ID[m[1] as string] ?? "ansm/detail-tension.html");
	}
	const calls: string[] = [];
	const f = async (input: string): Promise<Response> => {
		calls.push(input);
		if (input === ANSM_LIST_URL) {
			const l = opts.list ?? LIST_HTML;
			return typeof l === "string" ? new Response(l) : l();
		}
		if (input === DISPO_URL) {
			const d = opts.dispo ?? fixtureBytes("bdpm/CIS_CIP_Dispo_Spec.txt");
			return d instanceof Uint8Array ? new Response(d) : d();
		}
		if (input.startsWith(ANSM_ORIGIN)) {
			const path = input.slice(ANSM_ORIGIN.length);
			const custom = opts.detail?.(path);
			if (custom) return custom;
			const fixture = pathToFixture.get(path);
			if (fixture) return new Response(fixtureText(fixture));
		}
		return new Response("not found", { status: 404 });
	};
	return Object.assign(f, { calls });
}

export const detailCalls = (f: FakeFetcher): string[] => f.calls.filter((u) => u !== ANSM_LIST_URL && u !== DISPO_URL);
