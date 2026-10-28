import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ICON_SVG } from "../src/icon";

describe("GET /icon.svg", () => {
	it("serves the site icon as SVG, cached for a day", async () => {
		const res = await exports.default.fetch("https://medicaments-france.a3e.dev/icon.svg");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/svg+xml");
		expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
		expect(await res.text()).toBe(ICON_SVG);
	});

	it("is the monogram, with no text and no external reference", () => {
		expect(ICON_SVG).toContain('viewBox="0 0 512 512"');
		expect(ICON_SVG).toContain('<rect width="512" height="512" rx="112" fill="#0F5E57"/>');
		expect(ICON_SVG).toContain(
			'<polygon fill="#FFFFFF" points="136,376 136,136 196,136 256,248 316,136 376,136 376,376 320,376 320,232 268,328 244,328 192,232 192,376"/>',
		);
		expect(ICON_SVG).not.toMatch(/<text|href=|url\(/);
	});
});
