import { createMcpHandler } from "agents/mcp/server";
import { handleAdminIngest } from "./admin";
import { handleHealth } from "./health";
import { log } from "./ingest/http";
import { runIngest } from "./ingest/run";
import { handleLanding } from "./landing";
import { createServer } from "./mcp/server";

const RETRY_AFTER_SECONDS = 60;

/** `/mcp`: per-IP rate limit, then a stateless MCP handler built for this request. */
async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const { success } = await env.MCP_LIMIT.limit({ key: ip });
	if (!success) {
		return Response.json(
			{ error: "rate_limited", retry_after_seconds: RETRY_AFTER_SECONDS },
			{ status: 429, headers: { "Retry-After": String(RETRY_AFTER_SECONDS) } },
		);
	}
	return createMcpHandler(() => createServer(env, ctx), { route: "/mcp" })(request, env, ctx);
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === "/") return handleLanding();
		if (pathname === "/health") return handleHealth(request, env, ctx);
		if (pathname === "/admin/ingest") return handleAdminIngest(request, env, ctx);
		if (pathname === "/mcp") return handleMcp(request, env, ctx);
		return Response.json({ error: "not_found" }, { status: 404 });
	},

	async scheduled(_controller, env, ctx): Promise<void> {
		ctx.waitUntil(
			runIngest(env, fetch).then((outcome) => {
				if ("skipped" in outcome) log("ingest_skipped");
			}),
		);
	},
} satisfies ExportedHandler<Env>;
