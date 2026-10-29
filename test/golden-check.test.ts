import { describe, expect, it } from "vitest";
import { check, namedInToolResults, options, parseStream } from "../scripts/golden-check";

describe("golden check", () => {
	it("fails an answer whose only near-referral words are depuis/puis", () => {
		expect(check("Le Brevibloc est en rupture depuis mars, puis il reviendra.")).toBe("no pharmacist or doctor referral");
	});

	it("passes an answer that refers to a pharmacien", () => {
		expect(check("Demandez à votre pharmacien.")).toBeNull();
	});

	it("fails an answer that names Esmocard", () => {
		expect(check("Votre médecin peut prescrire Esmocard.")).toBe("names ESMOCARD");
	});
});

describe("parseStream", () => {
	it("reads model, tool calls, tool results and answer from a stream-json run", () => {
		const stream = [
			JSON.stringify({ type: "system", subtype: "init", model: "claude-test-1", tools: [], mcp_servers: [] }),
			"not json",
			JSON.stringify({
				type: "assistant",
				message: { content: [{ type: "tool_use", id: "t1", name: "mcp__medicaments-france__search_medicine", input: { query: "Brevibloc" } }] },
			}),
			JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ESMOLOL found" }] } }),
			JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "rupture" }] }] } }),
			"",
			JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Ask your doctor." }),
		].join("\n");
		expect(parseStream(stream)).toEqual({
			model: "claude-test-1",
			answer: "Ask your doctor.",
			toolCalls: [{ name: "mcp__medicaments-france__search_medicine", input: { query: "Brevibloc" } }],
			toolResultText: `ESMOLOL found\n${JSON.stringify([{ type: "text", text: "rupture" }])}`,
		});
	});

	it("returns an empty answer and no model when the stream has neither", () => {
		expect(parseStream("garbage\n")).toEqual({ model: null, answer: "", toolCalls: [], toolResultText: "" });
	});
});

describe("options", () => {
	const url = "https://example.test/mcp";

	it("accepts prompt 1 to 3 and a positive integer run count", () => {
		expect(options({ url, runs: "20", prompt: "3", log: "g.jsonl" })).toEqual({ url, runs: 20, prompt: 3, log: "g.jsonl", bare: false });
		expect(options({ url, runs: "3" })).toEqual({ url, runs: 3, prompt: null, log: undefined, bare: false });
	});

	it("enables bare mode only when --bare is given", () => {
		expect(options({ url, runs: "3", bare: true })?.bare).toBe(true);
		expect(options({ url, runs: "3", bare: false })?.bare).toBe(false);
		expect(options({ url, runs: "3" })?.bare).toBe(false);
	});

	it.each(["4", "0", "x", "2.0", " 2", "0x3", "0b11", ""])("rejects prompt %j", (prompt) => {
		expect(options({ url, runs: "3", prompt })).toBeNull();
	});

	it.each(["0", "01", "1.5", " 2", "0x3", "-1", ""])("rejects runs %j", (runs) => {
		expect(options({ url, runs })).toBeNull();
	});

	it("rejects a missing url", () => {
		expect(options({ runs: "3" })).toBeNull();
	});
});

describe("namedInToolResults", () => {
	it("tells whether a named medicine appears in the tool results", () => {
		expect(namedInToolResults("names LANDIOLOL", "le landiolol est disponible")).toBe(true);
		expect(namedInToolResults("names LANDIOLOL", "esmolol")).toBe(false);
	});

	it("is null when the answer names no medicine", () => {
		expect(namedInToolResults(null, "landiolol")).toBeNull();
		expect(namedInToolResults("no pharmacist or doctor referral", "landiolol")).toBeNull();
		expect(namedInToolResults("claude failed: timeout", "landiolol")).toBeNull();
	});
});
