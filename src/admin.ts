import { runIngest } from "./ingest/run";

const json = (body: unknown, status: number): Response => Response.json(body, { status });

async function digest(s: string): Promise<ArrayBuffer> {
	return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
}

/** Constant-time comparison of the SHA-256 digests of `a` and `b`. */
async function safeEqual(a: string, b: string): Promise<boolean> {
	const [da, db] = await Promise.all([digest(a), digest(b)]);
	return crypto.subtle.timingSafeEqual(da, db);
}

/** `POST /admin/ingest`: runs an ANSM ingest and responds with its summary. */
export async function handleAdminIngest(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
	const token = env.ADMIN_TOKEN;
	if (!token) return json({ error: "not_found" }, 404);
	if (!(await safeEqual(request.headers.get("Authorization") ?? "", `Bearer ${token}`))) {
		return json({ error: "unauthorized" }, 401);
	}
	if (request.method !== "POST") {
		return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
	}
	const outcome = await runIngest(env, fetch);
	if ("skipped" in outcome) return json({ error: "ingest_running" }, 409);
	if ("error" in outcome) {
		return json(
			{ run_id: null, status: "error", message: outcome.error, entries_seen: null, entries_new: null, entries_changed: null, entries_delisted: null },
			200,
		);
	}
	const { counts } = outcome;
	return json(
		{
			run_id: outcome.id,
			status: outcome.status,
			message: outcome.message,
			entries_seen: counts.entries_seen ?? null,
			entries_new: counts.entries_new ?? null,
			entries_changed: counts.entries_changed ?? null,
			entries_delisted: counts.entries_delisted ?? null,
		},
		200,
	);
}
