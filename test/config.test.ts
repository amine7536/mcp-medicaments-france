import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("wrangler.jsonc", () => {
	it("keeps Workers Logs on without invocation logs", () => {
		expect(env.TEST_OBSERVABILITY.enabled).toBe(true);
		expect(env.TEST_OBSERVABILITY.logs?.invocation_logs).toBe(false);
	});
});
