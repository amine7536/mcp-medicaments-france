import { describe, expect, it } from "vitest";
import readme from "../README.md?raw";
import { EXAMPLES } from "../src/landing";

describe("README", () => {
	it("lists the landing examples", () => {
		const section = readme.split("## Example questions\n\n")[1].split("\n\n")[0];
		expect(section.split("\n")).toEqual(EXAMPLES.map((e) => `- ${e.question} — ${e.behaviour}`));
	});

	it("states the approximate MCP rate limit", () => {
		expect(readme).toContain(
			"- No IP address, user agent or question text is stored. Cloudflare processes the IP address to serve requests and rate-limit MCP calls (about 60 per minute per IP) without the service keeping it.\n",
		);
	});
});
