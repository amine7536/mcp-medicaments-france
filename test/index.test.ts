import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://example.com";

describe("worker", () => {
	it("returns 404 JSON for any path", async () => {
		const res = await exports.default.fetch(`${BASE}/anything`);
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(await res.json()).toEqual({ error: "not_found" });
	});

	describe("pages", () => {
		const cases: { query: string; acceptLanguage?: string; lang: string }[] = [
			{ query: "", lang: "fr" },
			{ query: "?lang=en", lang: "en" },
			{ query: "", acceptLanguage: "en-GB", lang: "en" },
			{ query: "?lang=fr", acceptLanguage: "en-GB", lang: "fr" },
		];
		for (const path of ["/", "/privacy"]) {
			for (const { query, acceptLanguage, lang } of cases) {
				it(`serves ${path}${query} with Accept-Language ${acceptLanguage ?? "unset"} in ${lang}`, async () => {
					const headers: Record<string, string> = acceptLanguage ? { "Accept-Language": acceptLanguage } : {};
					const res = await exports.default.fetch(`${BASE}${path}${query}`, { headers });
					expect(res.status).toBe(200);
					expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
					expect(res.headers.get("content-language")).toBe(lang);
					expect((await res.text()).match(/<html lang="([^"]+)"/)?.[1]).toBe(lang);
				});
			}
		}

		it("answers HEAD / with an empty body", async () => {
			const res = await exports.default.fetch(`${BASE}/`, { method: "HEAD" });
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("");
		});

		it("answers POST / with 405", async () => {
			const res = await exports.default.fetch(`${BASE}/`, { method: "POST" });
			expect(res.status).toBe(405);
			expect(res.headers.get("Allow")).toBe("GET, HEAD");
		});

		it("links only static assets that exist, besides /health", async () => {
			const links = new Set<string>();
			for (const url of ["/?lang=fr", "/?lang=en", "/privacy?lang=fr", "/privacy?lang=en"]) {
				const html = await (await exports.default.fetch(`${BASE}${url}`)).text();
				for (const m of html.matchAll(/(?:href|src)="(\/[^"?]*)"/g)) links.add(m[1]);
			}
			links.delete("/health");
			expect([...links].sort()).toEqual(["/icon.svg", "/landing.js", "/style.css"]);
			for (const link of links) {
				expect((await env.ASSETS.fetch(`${BASE}${link}`)).status, link).toBe(200);
			}
		});
	});
});
