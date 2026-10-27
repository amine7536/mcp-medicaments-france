import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("worker", () => {
	it("returns 404 JSON for any path", async () => {
		const res = await exports.default.fetch("https://example.com/anything");
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(await res.json()).toEqual({ error: "not_found" });
	});
});
