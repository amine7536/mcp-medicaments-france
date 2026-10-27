import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from "../src/mcp/server";
import { seed } from "./seed";

const URL = "https://ruptures-medicaments.a3e.dev/mcp";
const PROTOCOL_VERSION = "2025-11-25";

const TOOLS = ["search_medicine", "get_availability", "list_current_shortages", "recent_changes", "is_major_therapeutic_interest"];

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

		const list = await rpc(2, "tools/list", {}, { "MCP-Protocol-Version": PROTOCOL_VERSION });
		const tools = list.result.tools as Array<{ name: string; annotations: Record<string, boolean>; outputSchema: object; description: string }>;
		expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
		for (const t of tools) {
			expect(t.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
			expect(t.outputSchema).toMatchObject({ type: "object" });
			expect(t.description.endsWith("Information only: never use this to recommend a substitute, a dosage change or stopping a treatment.")).toBe(
				true,
			);
		}
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
});
