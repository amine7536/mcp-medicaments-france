import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AiRunner, MODEL, type ModelAnswer, RESPONSE_SCHEMA, SYSTEM_PROMPT, workersAiExtractor } from "../src/ingest/extract";
import { NO_ANSWER } from "./fixtures";

const ID = "1376";
const LINES_1376 = [
	"À l’hôpital : rupture ;",
	"En ville : non concerné ;",
	"Causes : augmentation du volume de vente ;",
	"Remise à disposition au niveau du/des laboratoires exploitants : fin novembre 2026.",
	"Interdiction d'exportation des grossistes-répartiteurs.",
];

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

const logs = (): unknown[] => logSpy.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));

/** A fake binding whose `run` returns `result` and records its arguments. */
function fakeAi(result: unknown): AiRunner & { run: ReturnType<typeof vi.fn> } {
	return { run: vi.fn(async () => result) };
}

/** Extracts `lines` with a model answering `answer`. */
async function extract(answer: Partial<ModelAnswer>, lines = LINES_1376) {
	return workersAiExtractor(fakeAi({ response: { ...NO_ANSWER, ...answer } }))(lines, ID, 1000);
}

/** The extracted fields of `answer`, failing the test on `{ ok: false }`. */
async function fields(answer: Partial<ModelAnswer>, lines = LINES_1376) {
	const out = await extract(answer, lines);
	if (!out.ok) throw new Error("extraction failed");
	return out.fields;
}

describe("model call", () => {
	it("sends the numbered lines with the measured prompt, schema and temperature", async () => {
		const ai = fakeAi({ response: NO_ANSWER });
		await workersAiExtractor(ai)(["a", "b"], ID, 1000);
		expect(ai.run).toHaveBeenCalledTimes(1);
		const [model, inputs, options] = ai.run.mock.calls[0] as [string, Record<string, unknown>, AiOptions];
		expect(model).toBe(MODEL);
		expect(inputs).toEqual({
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: "1. a\n2. b" },
			],
			response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
			temperature: 0,
		});
		expect(options.signal).toBeInstanceOf(AbortSignal);
		expect(SYSTEM_PROMPT.split("\n")).toHaveLength(5);
	});

	it("makes no call for a page without observations", async () => {
		const ai = fakeAi({ response: NO_ANSWER });
		const out = await workersAiExtractor(ai)([], ID, 1000);
		expect(ai.run).not.toHaveBeenCalled();
		expect(out).toEqual({
			ok: true,
			fields: {
				scope: "inconnu",
				scope_raw: null,
				expected_return_earliest: null,
				expected_return_latest: null,
				expected_return_precision: null,
				expected_return_part: null,
				expected_return_raw: null,
			},
		});
	});
});

describe("scope", () => {
	const SIDES = ["rupture", "tension", "contingentement", "non_concerne", "inconnu"] as const;
	const impacted = (side: string): boolean => side === "rupture" || side === "tension" || side === "contingentement";

	it("maps every side combination to the scope", async () => {
		for (const hopital of SIDES) {
			for (const ville of SIDES) {
				const expected =
					impacted(ville) && impacted(hopital) ? "ville_hopital" : impacted(ville) ? "ville" : impacted(hopital) ? "hopital" : "inconnu";
				expect((await fields({ hopital, ville, lignes_lieu: [1, 2] })).scope, `${hopital}/${ville}`).toBe(expected);
			}
		}
	});

	it("stores the indexed lines, in the order given, without duplicates", async () => {
		expect(await fields({ hopital: "rupture", ville: "non_concerne", lignes_lieu: [2, 1, 2] })).toMatchObject({
			scope: "hopital",
			scope_raw: "En ville : non concerné ; | À l’hôpital : rupture ;",
		});
		expect((await fields({ lignes_lieu: [] })).scope_raw).toBeNull();
	});
});

describe("expected return", () => {
	it("stores the indexed line and the window of the date expression", async () => {
		expect(await fields({ ligne_retour: 4, retour: "fin novembre 2026" })).toMatchObject({
			expected_return_raw: "Remise à disposition au niveau du/des laboratoires exploitants : fin novembre 2026.",
			expected_return_earliest: "2026-11-01",
			expected_return_latest: "2026-11-30",
			expected_return_precision: "month",
			expected_return_part: "fin",
		});
		expect(logs()).toEqual([]);
	});

	it("stores no return for line 0", async () => {
		expect(await fields({ ligne_retour: 0, retour: "" })).toMatchObject({ expected_return_raw: null, expected_return_earliest: null });
		expect(logs()).toEqual([]);
	});

	it("accepts an expression that differs from the line only by case, accents or apostrophe", async () => {
		const lines = ["Date de remise à disposition prévue : fin d’année 2026."];
		expect(await fields({ ligne_retour: 1, retour: "FIN D'ANNEE 2026" }, lines)).toMatchObject({
			expected_return_raw: lines[0],
			expected_return_earliest: "2026-01-01",
			expected_return_precision: "year",
			expected_return_part: "fin",
		});
	});

	it("keeps the line with a null window and logs return_unparsed when the expression is not in the line", async () => {
		expect(await fields({ ligne_retour: 4, retour: "fin janvier 2027" })).toMatchObject({
			expected_return_raw: LINES_1376[3],
			expected_return_earliest: null,
			expected_return_precision: null,
		});
		expect(logs()).toEqual([{ event: "return_unparsed", id: ID }]);
	});

	it("rejects an expression that is a substring but not whole words of the line", async () => {
		expect(await fields({ ligne_retour: 4, retour: "novembre 202" })).toMatchObject({
			expected_return_raw: LINES_1376[3],
			expected_return_earliest: null,
		});
		expect(logs()).toEqual([{ event: "return_unparsed", id: ID }]);
	});

	it("keeps the line with a null window and logs return_unparsed for an empty expression", async () => {
		expect(await fields({ ligne_retour: 4, retour: "" })).toMatchObject({ expected_return_raw: LINES_1376[3], expected_return_earliest: null });
		expect(logs()).toEqual([{ event: "return_unparsed", id: ID }]);
	});

	it("gives a null window and no log for an undetermined or unknown return", async () => {
		const lines = ["Date de remise à disposition prévue indéterminée.", "Date de remise à disposition normale inconnue"];
		expect(await fields({ ligne_retour: 1, retour: "indéterminée" }, lines)).toMatchObject({ expected_return_raw: lines[0], expected_return_earliest: null });
		expect(await fields({ ligne_retour: 2, retour: "inconnue" }, lines)).toMatchObject({ expected_return_raw: lines[1], expected_return_earliest: null });
		expect(logs()).toEqual([]);
	});

	it("logs nothing when an expression copied from another line fails on an undetermined line (626)", async () => {
		const lines = [
			"Rupture de stock de la présentation en flacon de 10 ml ;",
			"Remise à disposition normale indéterminée de la présentation en flacon de 10 ml ;",
			"Remise à disposition normale de la présentation en flacon de 50 ml à compter de fin novembre 2024.",
		];
		expect(await fields({ ligne_retour: 2, retour: "fin novembre 2024" }, lines)).toMatchObject({
			expected_return_raw: lines[1],
			expected_return_earliest: null,
		});
		expect(logs()).toEqual([]);
	});

	it("logs nothing when an expression in an undetermined line does not parse", async () => {
		const lines = ["Remise à disposition de la boîte de 20 prochainement, des autres présentations indéterminée."];
		expect(await fields({ ligne_retour: 1, retour: "prochainement" }, lines)).toMatchObject({ expected_return_raw: lines[0], expected_return_earliest: null });
		expect(logs()).toEqual([]);
	});

	it("logs return_unparsed when an expression in the line does not parse", async () => {
		const lines = ["Remise à disposition prévue prochainement"];
		expect(await fields({ ligne_retour: 1, retour: "prochainement" }, lines)).toMatchObject({ expected_return_raw: lines[0], expected_return_earliest: null });
		expect(logs()).toEqual([{ event: "return_unparsed", id: ID }]);
	});

	it("trims the stored line", async () => {
		const lines = ["  Date de remise à disposition prévue courant 2027.  "];
		expect(await fields({ ligne_retour: 1, retour: "courant 2027" }, lines)).toMatchObject({
			expected_return_raw: "Date de remise à disposition prévue courant 2027.",
			expected_return_precision: "year",
		});
	});
});

describe("reading the binding result", () => {
	const answer: ModelAnswer = { hopital: "rupture", ville: "non_concerne", lignes_lieu: [1, 2], ligne_retour: 4, retour: "fin novembre 2026" };

	it("accepts a response given as a JSON string", async () => {
		const out = await workersAiExtractor(fakeAi({ response: JSON.stringify(answer) }))(LINES_1376, ID, 1000);
		expect(out).toMatchObject({ ok: true, fields: { scope: "hopital", expected_return_earliest: "2026-11-01" } });
	});

	it.each<[string, unknown, string]>([
		["a bare string", "{}", "no response"],
		["null", null, "no response"],
		["an async job", { request_id: "x" }, "no response"],
		["a non-JSON response string", { response: "Voici la réponse" }, "response is not JSON"],
		["a non-object response", { response: 42 }, "response is not an object"],
		["a JSON string of a non-object", { response: "42" }, "response is not an object"],
		["an unknown enum value", { response: { ...answer, ville: "pharmacie" } }, "invalid response"],
		["a missing field", { response: { hopital: "rupture", ville: "inconnu", lignes_lieu: [], ligne_retour: 0 } }, "invalid response"],
		["a wrong type", { response: { ...answer, ligne_retour: "4" } }, "invalid response"],
		["a non-integer index", { response: { ...answer, ligne_retour: 1.5 } }, "invalid response"],
		["a place line out of range", { response: { ...answer, lignes_lieu: [6] } }, "line index out of range"],
		["a place line 0", { response: { ...answer, lignes_lieu: [0] } }, "line index out of range"],
		["a return line out of range", { response: { ...answer, ligne_retour: 6 } }, "line index out of range"],
		["a negative return line", { response: { ...answer, ligne_retour: -1 } }, "line index out of range"],
	])("fails on %s", async (_, result, reason) => {
		const out = await workersAiExtractor(fakeAi(result))(LINES_1376, ID, 1000);
		expect(out).toEqual({ ok: false });
		expect(logs()).toEqual([{ event: "extract_failed", id: ID, reason }]);
	});

	it("fails when the binding throws", async () => {
		const ai: AiRunner = {
			run: async () => {
				throw new Error("JSON Mode couldn't be met");
			},
		};
		expect(await workersAiExtractor(ai)(LINES_1376, ID, 1000)).toEqual({ ok: false });
		expect(logs()).toEqual([{ event: "extract_failed", id: ID, reason: "JSON Mode couldn't be met" }]);
	});

	it("times out a call that never settles, even when the binding ignores the signal", async () => {
		const ai: AiRunner = { run: () => new Promise(() => {}) };
		expect(await workersAiExtractor(ai)(LINES_1376, ID, 10)).toEqual({ ok: false });
		expect(logs()).toEqual([{ event: "extract_failed", id: ID, reason: "timeout after 10 ms" }]);
	});

	it("passes an abort signal that fires after the timeout", async () => {
		let signal: AbortSignal | undefined;
		const ai: AiRunner = {
			run: (_model, _inputs, options) => {
				signal = options.signal;
				return new Promise(() => {});
			},
		};
		await workersAiExtractor(ai)(LINES_1376, ID, 10);
		await vi.waitUntil(() => signal?.aborted === true, { timeout: 1000 });
	});
});
