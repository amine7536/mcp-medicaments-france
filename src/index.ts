import { createMcpHandler, localhostAllowedOrigins, originValidationResponse } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { methodNotAllowed } from "hono/method-not-allowed";
import { handleAdminIngest } from "./admin";
import { handleHealth } from "./health";
import { log } from "./ingest/http";
import { runIngest } from "./ingest/run";
import { createServer } from "./mcp/server";

const RETRY_AFTER_SECONDS = 60;

const MCP_CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Expose-Headers": "mcp-session-id",
	"Access-Control-Max-Age": "86400",
};

/** A copy of the response with the `/mcp` CORS headers set, keeping its status and body stream. */
function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) headers.set(name, value);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** The static page at `/<lang>/<page>` in the language picked from `?lang`, then the first `Accept-Language` tag, then French. */
async function handlePage(request: Request, env: Env, page: "" | "privacy"): Promise<Response> {
	const url = new URL(request.url);
	const param = url.searchParams.get("lang");
	const first = (request.headers.get("Accept-Language") ?? "").split(",")[0].split(";")[0].trim().toLowerCase();
	const lang = param === "fr" || param === "en" ? param : first.startsWith("en") ? "en" : "fr";
	const asset = await env.ASSETS.fetch(new URL(`/${lang}/${page}`, url));
	return new Response(asset.body, {
		status: asset.status,
		headers: {
			"content-type": asset.headers.get("content-type") ?? "text/html; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
			Vary: "Accept-Language",
			"Content-Language": lang,
		},
	});
}

/**
 * `/mcp`: per-IP rate limit, then a 403 for a browser Origin other than localhost (or this `*.workers.dev` host),
 * the CORS preflight answer, or a stateless MCP handler built for this request; every answer after the rate limit carries the CORS headers.
 */
async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const { success } = await env.MCP_LIMIT.limit({ key: ip });
	if (!success) {
		return Response.json(
			{ error: "rate_limited", retry_after_seconds: RETRY_AFTER_SECONDS },
			{ status: 429, headers: { "Retry-After": String(RETRY_AFTER_SECONDS) } },
		);
	}
	const hostname = new URL(request.url).hostname;
	const allowedOrigins = hostname.endsWith(".workers.dev") ? [...localhostAllowedOrigins(), hostname] : localhostAllowedOrigins();
	const rejected = originValidationResponse(request, allowedOrigins);
	if (rejected) return withCors(rejected);
	if (request.method === "OPTIONS") return withCors(new Response(null, { status: 200 }));
	return withCors(await createMcpHandler(() => createServer(env, ctx)).fetch(request));
}

const app = new Hono<{ Bindings: Env }>({ getPath: (req) => new URL(req.url).pathname });

app.use(
	methodNotAllowed({
		app,
		onMethodNotAllowed: (c, methods) =>
			c.json({ error: "method_not_allowed" }, 405, { Allow: methods.join(", ") }),
	}),
);
app.get("/", (c) => handlePage(c.req.raw, c.env, ""));
app.get("/privacy", (c) => handlePage(c.req.raw, c.env, "privacy"));
// Hono types executionCtx narrowly; at runtime it is the Worker's ExecutionContext passed through app.fetch.
app.get("/health", (c) => handleHealth(c.req.raw, c.env, c.executionCtx as ExecutionContext));
app.all("/admin/ingest", (c) => handleAdminIngest(c.req.raw, c.env, c.executionCtx as ExecutionContext));
app.all("/mcp", (c) => handleMcp(c.req.raw, c.env, c.executionCtx as ExecutionContext));
app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err) => {
	throw err;
});

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
