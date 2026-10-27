import { handleAdminIngest } from "./admin";
import { runIngest } from "./ingest/run";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === "/admin/ingest") return handleAdminIngest(request, env, ctx);
		return Response.json({ error: "not_found" }, { status: 404 });
	},

	async scheduled(_controller, env, ctx): Promise<void> {
		ctx.waitUntil(runIngest(env, fetch));
	},
} satisfies ExportedHandler<Env>;
