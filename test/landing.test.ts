import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LANDING_HTML, MCP_ENDPOINT, NON_ENDORSEMENT } from "../src/landing";
import { ANSM_SOURCE_URL, BDPM_SOURCE_URL, COVERAGE_NOTE, DISCLAIMER } from "../src/mcp/envelope";

describe("GET /", () => {
	it("returns the landing page as cacheable HTML", async () => {
		const res = await exports.default.fetch("https://ruptures-medicaments.a3e.dev/");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
		const html = await res.text();
		for (const s of [MCP_ENDPOINT, COVERAGE_NOTE, DISCLAIMER, NON_ENDORSEMENT, ANSM_SOURCE_URL, BDPM_SOURCE_URL, "Ruptures de médicaments (France)"]) {
			expect(html).toContain(s);
		}
		expect(res.headers.get("set-cookie")).toBeNull();
	});

	it("loads no external script, stylesheet, font or image", () => {
		expect(LANDING_HTML).not.toMatch(/<script|<link|<img|@import|url\(/i);
	});

	it("keeps the content order", () => {
		const headings = [...LANDING_HTML.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
		expect(headings).toEqual(["What it is", "Endpoint", "Connect", "Tools", "Coverage", "Sources", "Licence", "Privacy", "Links"]);
	});
});
