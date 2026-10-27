import { handleAdminIngest } from "./admin";
import { log } from "./ingest/http";
import { runIngest } from "./ingest/run";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === "/admin/ingest") return handleAdminIngest(request, env, ctx);
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
