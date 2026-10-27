import { RUNNING_TTL_MS, runIngest } from "./ingest/run";

const json = (body: unknown, status: number): Response => Response.json(body, { status });

async function digest(s: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Constant-time comparison of the SHA-256 digests of `a` and `b`. */
async function safeEqual(a: string, b: string): Promise<boolean> {
	const [da, db] = await Promise.all([digest(a), digest(b)]);
	let diff = 0;
	for (let i = 0; i < da.length; i++) diff |= (da[i] as number) ^ (db[i] as number);
	return diff === 0;
}

/** `POST /admin/ingest`: starts an ANSM ingest in the background. */
export async function handleAdminIngest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const token = (env as Env & { ADMIN_TOKEN?: string }).ADMIN_TOKEN;
	if (!token) return json({ error: "not_found" }, 404);
	if (request.method !== "POST") {
		return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
	}
	if (!(await safeEqual(request.headers.get("Authorization") ?? "", `Bearer ${token}`))) {
		return json({ error: "unauthorized" }, 401);
	}
	const since = new Date(Date.now() - RUNNING_TTL_MS).toISOString();
	const running = await env.DB.prepare(
		"SELECT 1 FROM ingest_runs WHERE source = 'ansm' AND status = 'running' AND started_at >= ? LIMIT 1",
	)
		.bind(since)
		.first();
	if (running !== null) return json({ error: "ingest_running" }, 409);
	ctx.waitUntil(runIngest(env, fetch));
	return json({ accepted: true }, 202);
}
