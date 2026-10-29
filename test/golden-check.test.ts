import { describe, expect, it } from "vitest";
import { check, parseStream } from "../scripts/golden-check";

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
