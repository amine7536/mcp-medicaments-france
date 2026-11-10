import { env } from "cloudflare:workers";
import { type AiRunner, type Extractor, type ModelAnswer, workersAiExtractor } from "../src/ingest/extract";
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

/** The model answer for a page with no side and no return. */
export const NO_ANSWER: ModelAnswer = { hopital: "inconnu", ville: "inconnu", lignes_lieu: [], ligne_retour: 0, retour: "" };

/** Model answers for the rupture/tension detail fixtures, by list id; line numbers match each fixture's observation lines. */
export const FIXTURE_ANSWERS: Record<string, ModelAnswer> = {
	"1566": { ...NO_ANSWER, ligne_retour: 4, retour: "fin novembre 2026" },
	"1625": { ...NO_ANSWER, hopital: "rupture", lignes_lieu: [1], ligne_retour: 3, retour: "courant 2027" },
	"1624": { ...NO_ANSWER, ville: "tension", lignes_lieu: [1], ligne_retour: 4, retour: "début décembre 2026" },
	"880": { ...NO_ANSWER, ville: "contingentement", lignes_lieu: [2] },
	"1510": { ...NO_ANSWER, ligne_retour: 4, retour: "indéterminée" },
	"256": { ...NO_ANSWER, ligne_retour: 3, retour: "inconnue" },
};

export type FakeRun = AiRunner["run"];

export interface StubExtractor extends Extractor {
	/** Ids the extractor was called for. */
	calls: string[];
}

/**
 * The real Workers AI extractor over a fake `Ai` per call: `run` resolves `{ response: answers[id] }` (default
 * `NO_ANSWER`), or is the given fake `run` (one that throws or never resolves).
 */
export function stubExtract(answers: Record<string, ModelAnswer> = FIXTURE_ANSWERS, run?: FakeRun): StubExtractor {
	const calls: string[] = [];
	const extract: Extractor = (lines, id, timeoutMs) => {
		calls.push(id);
		const ai: AiRunner = { run: run ?? (async () => ({ response: answers[id] ?? NO_ANSWER })) };
		return workersAiExtractor(ai)(lines, id, timeoutMs);
	};
	return Object.assign(extract, { calls });
}

/** A fake `AI` binding for tests that go through `/admin/ingest` or `scheduled`; every page gets `NO_ANSWER`. */
export function fakeAi(): Ai {
	const ai: AiRunner = { run: async () => ({ response: NO_ANSWER }) };
	// Only `run` is used by the ingest; the rest of the binding is never reached.
	return ai as unknown as Ai;
}
