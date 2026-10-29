import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { DISCLAIMER, SAFETY } from "../src/mcp/envelope";
import { INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from "../src/mcp/server";
import { INFO_ONLY } from "../src/mcp/tool";
import { seed } from "./seed";

const URL = "https://medicaments-france.a3e.dev/mcp";
const PROTOCOL_VERSION = "2025-11-25";

const SUBSTITUTION_RULE =
	"Substitution, dosage and stopping questions: if the user asks what to take instead, for a substitute, an alternative, an equivalent or a replacement, or whether to change a dose or stop a treatment, do not name or list any other medicine, brand, presentation or active substance, whether from your own knowledge or from tool results. Other medicines returned by the tools, including products with the same active substance, are not alternatives. Answer only with the shortage status of the medicine asked about, say that only a pharmacist or doctor can choose an alternative or change a treatment, and give that medicine's ANSM page link when there is one.";
const OPENING =
	"Data on medicines in France from the ANSM (Agence nationale de sécurité du médicament) and the BDPM (Base de données publique des médicaments): reference information on boxes, prices, reimbursement, prescription and dispensing conditions and ANSM safety information, and medicine shortages. The shortage list covers mainly medicines of major therapeutic interest declared by manufacturers.";
const NEW_INFO_ONLY = "Public data for information only; not medical advice.";

const TOOLS = ["search_medicine", "get_availability", "list_current_shortages", "recent_changes", "is_major_therapeutic_interest", "get_medicine_info"];

async function rpc(id: number, method: string, params: Record<string, unknown>, headers: Record<string, string> = {}) {
	const res = await exports.default.fetch(URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
	});
	expect(res.status).toBe(200);
	// The 2025 lane answers on an SSE stream: the JSON-RPC response is the `data:` line carrying this id.
	expect(res.headers.get("content-type")).toContain("text/event-stream");
	const messages = (await res.text())
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice("data: ".length)) as { id?: number; result: Record<string, unknown> });
	const response = messages.find((m) => m.id === id);
	expect(response).toBeDefined();
	return response as { result: Record<string, unknown> };
}

// Seeding and many D1 round-trips run slower on CI runners.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

beforeAll(async () => {
	await seed();
});

describe("/mcp", () => {
	it("serves initialize and tools/list on the 2025-11-25 lane", async () => {
		const init = await rpc(1, "initialize", {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "test", version: "1.0.0" },
		});
		expect(init.result).toMatchObject({
			protocolVersion: PROTOCOL_VERSION,
			serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
			instructions: INSTRUCTIONS,
			capabilities: { tools: {} },
		});
		expect(INSTRUCTIONS.startsWith(`${OPENING} "Not listed" does not mean "available".`)).toBe(true);
		expect(init.result.instructions).toContain(SUBSTITUTION_RULE);
		expect(INFO_ONLY).toBe(NEW_INFO_ONLY);

		const list = await rpc(2, "tools/list", {}, { "MCP-Protocol-Version": PROTOCOL_VERSION });
		const tools = list.result.tools as Array<{ name: string; annotations: Record<string, boolean>; outputSchema: object; description: string }>;
		expect(tools).toHaveLength(6);
		expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
		for (const t of tools) {
			expect(t.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
			expect(t.outputSchema).toMatchObject({ type: "object" });
			expect(t.description.endsWith(NEW_INFO_ONLY)).toBe(true);
		}
	});

	it("tool and input descriptions give no instruction to the model", async () => {
		const list = await rpc(5, "tools/list", {}, { "MCP-Protocol-Version": PROTOCOL_VERSION });
		const tools = list.result.tools as Array<{ name: string; description: string; inputSchema: { properties?: Record<string, { description?: string }> } }>;
		const descriptions = tools.flatMap((t) => [t.description, ...Object.values(t.inputSchema.properties ?? {}).map((p) => p.description ?? "")]);
		expect(descriptions.filter((d) => d !== "").length).toBeGreaterThan(tools.length);
		for (const d of descriptions) {
			expect(d).not.toMatch(/never|other tool|instruction/i);
		}
	});

	it("tools/list carries neither the safety nor the disclaimer text, tool results carry both", async () => {
		const list = await rpc(6, "tools/list", {}, { "MCP-Protocol-Version": PROTOCOL_VERSION });
		const serialized = JSON.stringify(list.result.tools);
		expect(serialized).not.toContain(SAFETY);
		expect(serialized).not.toContain(DISCLAIMER);

		const call = await rpc(
			7,
			"tools/call",
			{ name: "get_availability", arguments: { cis: "60000001" } },
			{ "MCP-Protocol-Version": PROTOCOL_VERSION },
		);
		expect(call.result.isError).toBeFalsy();
		const content = call.result.structuredContent as { safety: string; disclaimer: string };
		expect(content.safety).toBe(SAFETY);
		expect(content.disclaimer).toBe(DISCLAIMER);
	});

	it("returns a tool result through the SDK output validation", async () => {
		const call = await rpc(
			3,
			"tools/call",
			{ name: "get_availability", arguments: { cis: "60000001" } },
			{ "MCP-Protocol-Version": PROTOCOL_VERSION },
		);
		expect(call.result.isError).toBeFalsy();
		expect(call.result.structuredContent).toMatchObject({ data: { kind: "availability", medicine: { cis: "60000001" } } });
	});

	it("calls get_medicine_info by CIP13 through the SDK output validation", async () => {
		const call = await rpc(
			4,
			"tools/call",
			{ name: "get_medicine_info", arguments: { cip13: "3400930000011" } },
			{ "MCP-Protocol-Version": PROTOCOL_VERSION },
		);
		expect(call.result.isError).toBeFalsy();
		const data = (call.result.structuredContent as { data: { kind: string; medicine: { cis: string }; presentations: Array<{ cip13: string }> } }).data;
		expect(data).toMatchObject({ kind: "info", medicine: { cis: "60000001" } });
		expect(data.presentations[0]?.cip13).toBe("3400930000011");
	});

	it("rate-limited: 429 JSON with Retry-After: 60, keyed on the client IP", async () => {
		const limit = vi.fn(async () => ({ success: false }));
		const ctx = createExecutionContext();
		const res = await worker.fetch(
			new Request<unknown, IncomingRequestCfProperties>(URL, { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.7" } }),
			{ ...env, MCP_LIMIT: { limit } },
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBe("60");
		expect(await res.json()).toEqual({ error: "rate_limited", retry_after_seconds: 60 });
		expect(limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
	});

	it("PUT reaches the MCP handler, not the router's 405 or 404", async () => {
		const limit = vi.fn(async () => ({ success: true }));
		const ctx = createExecutionContext();
		const res = await worker.fetch(new Request<unknown, IncomingRequestCfProperties>(URL, { method: "PUT" }), { ...env, MCP_LIMIT: { limit } }, ctx);
		await waitOnExecutionContext(ctx);
		expect(limit).toHaveBeenCalledOnce();
		const body = await res.text();
		expect(body).not.toBe(JSON.stringify({ error: "method_not_allowed" }));
		expect(body).not.toBe(JSON.stringify({ error: "not_found" }));
	});

	it("a handler exception rejects fetch instead of answering 500", async () => {
		const limit = vi.fn(async () => {
			throw new Error("limiter down");
		});
		const ctx = createExecutionContext();
		await expect(
			worker.fetch(new Request<unknown, IncomingRequestCfProperties>(URL, { method: "POST" }), { ...env, MCP_LIMIT: { limit } }, ctx),
		).rejects.toThrow("limiter down");
	});
});

describe("unknown paths", () => {
	it("404 JSON", async () => {
		const res = await exports.default.fetch(`${URL}/unknown`);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "not_found" });
	});
});
