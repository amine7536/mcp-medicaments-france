import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import server from "../server.json";
import { MCP_ENDPOINT } from "../src/landing";
import { SERVER_TITLE, SERVER_VERSION, SERVER_WEBSITE_URL } from "../src/mcp/server";

describe("server.json", () => {
	it("is a registry entry matching the deployed server", () => {
		expect(server.description.length).toBeLessThanOrEqual(100);
		expect(server.title.length).toBeLessThanOrEqual(100);
		expect(server.title).toBe(SERVER_TITLE);
		expect(server.websiteUrl).toBe(SERVER_WEBSITE_URL);
		expect(server.version).toBe(SERVER_VERSION);
		expect(server.name).toBe("io.github.amine7536/medicaments-france");
		expect(server.remotes).toEqual([{ type: "streamable-http", url: MCP_ENDPOINT }]);
	});

	it("has the same version as package.json", () => {
		expect(pkg.version).toBe(SERVER_VERSION);
	});
});
