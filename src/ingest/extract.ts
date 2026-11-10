import { z } from "zod";
import { type ExpectedReturn, isUndetermined, parseReturnWhen } from "../lib/dates";
import { normalize } from "../lib/normalize";
import type { DetailFields, Scope } from "./ansm";
import { errorMessage, log } from "./http";

/** The detail columns read from the observation lines. */
export type ExtractedFields = Omit<DetailFields, "situation_start" | "dci">;

export type ExtractOutcome = { ok: true; fields: ExtractedFields } | { ok: false };

/** Reads the scope and expected return of one detail page from its observation lines. */
export type Extractor = (lines: string[], id: string, timeoutMs: number) => Promise<ExtractOutcome>;

/** The `run` method of the Workers AI binding, as the extractor calls it. */
export interface AiRunner {
	run(model: typeof MODEL, inputs: Ai_Cf_Meta_Llama_3_3_70B_Instruct_Fp8_Fast_Messages, options: AiOptions): Promise<unknown>;
}

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Measured prompt (46 pages, see the change's evidence); re-measure before changing a word. */
export const SYSTEM_PROMPT = [
	"Tu lis les observations numérotées d'une fiche ANSM de rupture ou tension d'approvisionnement d'un médicament. Réponds en JSON.",
	"hopital / ville : situation du médicament de ce côté : rupture, tension, contingentement (distribution contingentée, contingentement quantitatif ou qualitatif), non_concerne (non concerné, non impacté, distribution normale). Réponds inconnu pour un côté que le texte ne nomme pas explicitement (« à l'hôpital », « hôpitaux », « en ville », « officines »...) : une rupture ou une tension sans lieu précisé donne inconnu des deux côtés. Les phrases sur une importation, une rétrocession, une « mise à disposition exceptionnelle » ou des produits alternatifs ne déterminent jamais un côté : seules les phrases sur la situation du médicament lui-même (sa rupture, sa tension, son contingentement) comptent. « disponible(s) à l'hôpital », « rétrocédé(es) » ou « en ville » dans une phrase qui dit où le produit reste disponible ne désignent jamais un côté en rupture ; un côté n'est rempli que si la phrase dit que le médicament y est en rupture, en tension ou contingenté.",
	"lignes_lieu : numéros des lignes d'où tu tires hopital et ville (liste vide si les deux sont inconnu).",
	"ligne_retour : numéro de la ligne qui donne la remise à disposition prévue, 0 s'il n'y en a pas.",
	"retour : copie mot pour mot, telle qu'écrite dans cette ligne, de la seule expression de date ou de période de remise à disposition prévue (ex. « fin novembre 2026 », « courant 2026 »), ou le mot de la ligne qui dit qu'elle est indéterminée/inconnue ; chaîne vide si ligne_retour vaut 0. Une date d'arrêt de commercialisation ou de mise à disposition d'une importation n'est pas une remise à disposition.",
].join("\n");

const SIDES = ["rupture", "tension", "contingentement", "non_concerne", "inconnu"] as const;
const IMPACTED = new Set<string>(["rupture", "tension", "contingentement"]);

export const RESPONSE_SCHEMA = {
	type: "object",
	properties: {
		hopital: { type: "string", enum: SIDES },
		ville: { type: "string", enum: SIDES },
		lignes_lieu: { type: "array", items: { type: "integer" } },
		ligne_retour: { type: "integer" },
		retour: { type: "string" },
	},
	required: ["hopital", "ville", "lignes_lieu", "ligne_retour", "retour"],
};

const Answer = z.object({
	hopital: z.enum(SIDES),
	ville: z.enum(SIDES),
	lignes_lieu: z.array(z.number().int()),
	ligne_retour: z.number().int(),
	retour: z.string(),
});
export type ModelAnswer = z.infer<typeof Answer>;

const NO_RETURN: ExpectedReturn = { earliest: null, latest: null, precision: null, part: null };

/** Fields of a page whose observations say nothing: no side, no return. */
export const NO_FIELDS: ExtractedFields = {
	scope: "inconnu",
	scope_raw: null,
	expected_return_earliest: null,
	expected_return_latest: null,
	expected_return_precision: null,
	expected_return_part: null,
	expected_return_raw: null,
};

class ExtractError extends Error {}

/** Whether `expr` occurs as whole words in `line`, folding case, accents and apostrophes. */
function occursIn(expr: string, line: string): boolean {
	const e = normalize(expr);
	return e !== "" && ` ${normalize(line)} `.includes(` ${e} `);
}

/** The model answer of a binding result: an object `response`, or a JSON string of one. */
function readAnswer(result: unknown): ModelAnswer {
	if (typeof result !== "object" || result === null || !("response" in result)) throw new ExtractError("no response");
	let response: unknown = result.response;
	if (typeof response === "string") {
		try {
			response = JSON.parse(response);
		} catch {
			throw new ExtractError("response is not JSON");
		}
	}
	if (typeof response !== "object" || response === null) throw new ExtractError("response is not an object");
	const parsed = Answer.safeParse(response);
	if (!parsed.success) throw new ExtractError("invalid response");
	return parsed.data;
}

/** Maps a validated answer to the stored columns; every raw string is a page line picked by index. */
function toFields(lines: string[], a: ModelAnswer, id: string): ExtractedFields {
	const inRange = (n: number): boolean => n >= 1 && n <= lines.length;
	if (!a.lignes_lieu.every(inRange) || !(a.ligne_retour === 0 || inRange(a.ligne_retour))) throw new ExtractError("line index out of range");

	const ville = IMPACTED.has(a.ville);
	const hopital = IMPACTED.has(a.hopital);
	const scope: Scope = ville && hopital ? "ville_hopital" : ville ? "ville" : hopital ? "hopital" : "inconnu";
	const placeLines = [...new Set(a.lignes_lieu)].map((n) => lines[n - 1] as string);

	let raw: string | null = null;
	let window = NO_RETURN;
	if (a.ligne_retour !== 0) {
		raw = (lines[a.ligne_retour - 1] as string).trim();
		const retour = a.retour.trim();
		if (retour !== "" && occursIn(retour, raw) && !isUndetermined(retour)) window = parseReturnWhen(retour);
		if (window.earliest === null && !isUndetermined(raw)) log("return_unparsed", { id });
	}

	return {
		scope,
		scope_raw: placeLines.length > 0 ? placeLines.join(" | ") : null,
		expected_return_earliest: window.earliest,
		expected_return_latest: window.latest,
		expected_return_precision: window.precision,
		expected_return_part: window.part,
		expected_return_raw: raw,
	};
}

/**
 * Runs `call` with a signal that aborts after `ms`, and rejects after `ms` even when the callee ignores the signal.
 * One timer serves both and is cleared when the call settles, so finished calls leave no pending timer.
 */
async function withTimeout<T>(ms: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			const reason = new ExtractError(`timeout after ${ms} ms`);
			controller.abort(reason);
			reject(reason);
		}, ms);
	});
	try {
		return await Promise.race([call(controller.signal), expired]);
	} finally {
		clearTimeout(timer);
	}
}

/** The Workers AI extractor: one JSON-mode call per page, validated and mapped to page lines. */
export function workersAiExtractor(ai: AiRunner): Extractor {
	return async (lines, id, timeoutMs) => {
		if (lines.length === 0) return { ok: true, fields: NO_FIELDS };
		const inputs: Ai_Cf_Meta_Llama_3_3_70B_Instruct_Fp8_Fast_Messages = {
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: lines.map((line, i) => `${i + 1}. ${line}`).join("\n") },
			],
			response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
			temperature: 0,
		};
		try {
			const result = await withTimeout(timeoutMs, (signal) => ai.run(MODEL, inputs, { signal }));
			return { ok: true, fields: toFields(lines, readAnswer(result), id) };
		} catch (err) {
			log("extract_failed", { id, reason: errorMessage(err) });
			return { ok: false };
		}
	};
}
