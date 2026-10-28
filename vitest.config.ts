import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { experimental_readRawConfig } from "wrangler";
import { defineConfig } from "vitest/config";

const TEST_MIGRATIONS = await readD1Migrations("./migrations");

// The observability block of wrangler.jsonc as written, so a test can pin the logging settings.
const TEST_OBSERVABILITY = experimental_readRawConfig({ config: "./wrangler.jsonc" }).rawConfig.observability ?? {};

// Fixture bytes (base64, keyed by path under test/fixtures), so binary files reach workerd unchanged.
const FIXTURES_DIR = "./test/fixtures";
const TEST_FIXTURES: Record<string, string> = {};
for (const entry of await readdir(FIXTURES_DIR, { recursive: true, withFileTypes: true })) {
	if (!entry.isFile()) continue;
	const path = join(entry.parentPath, entry.name);
	TEST_FIXTURES[path.slice(join(FIXTURES_DIR).length + 1)] = (await readFile(path)).toString("base64");
}

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: { bindings: { TEST_MIGRATIONS, TEST_FIXTURES, TEST_OBSERVABILITY, ADMIN_TOKEN: "s3cret-token" } },
		}),
	],
	test: {
		setupFiles: ["./test/apply-migrations.ts"],
	},
});
