import { createMcpHandler } from "agents/mcp/server";
import { Hono } from "hono";
import { methodNotAllowed } from "hono/method-not-allowed";
import { handleAdminIngest } from "./admin";
import { handleHealth } from "./health";
import { log } from "./ingest/http";
import { runIngest } from "./ingest/run";
import { renderLanding, resolveLang } from "./landing";
import { createServer } from "./mcp/server";

const RETRY_AFTER_SECONDS = 60;

/** `GET /`: the landing page in the language picked from `?lang` or `Accept-Language`. */
function handleLanding(request: Request, url: URL): Response {
	const lang = resolveLang(url, request.headers.get("Accept-Language"));
	return new Response(renderLanding(lang), {
		headers: {
			"content-type": "text/html; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
			Vary: "Accept-Language",
			"Content-Language": lang,
		},
	});
}

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

const app = new Hono<{ Bindings: Env }>();

app.use(
	methodNotAllowed({
		app,
		onMethodNotAllowed: (c, methods) =>
			c.json({ error: "method_not_allowed" }, 405, { Allow: methods.join(", ") }),
	}),
);
app.get("/", (c) => handleLanding(c.req.raw, new URL(c.req.url)));
// Hono types executionCtx narrowly; at runtime it is the Worker's ExecutionContext passed through app.fetch.
app.get("/health", (c) => handleHealth(c.req.raw, c.env, c.executionCtx as ExecutionContext));
app.all("/admin/ingest", (c) => handleAdminIngest(c.req.raw, c.env, c.executionCtx as ExecutionContext));
app.all("/mcp", (c) => handleMcp(c.req.raw, c.env, c.executionCtx as ExecutionContext));
app.notFound((c) => c.json({ error: "not_found" }, 404));

export default {
	fetch: (request, env, ctx) => app.fetch(request, env, ctx),

	async scheduled(_controller, env, ctx): Promise<void> {
		ctx.waitUntil(
			runIngest(env, fetch).then((outcome) => {
				if ("skipped" in outcome) log("ingest_skipped");
			}),
		);
	},
} satisfies ExportedHandler<Env>;
