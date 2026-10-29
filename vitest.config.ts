import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const TEST_MIGRATIONS = await readD1Migrations("./migrations");

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
			miniflare: { bindings: { TEST_MIGRATIONS, TEST_FIXTURES, ADMIN_TOKEN: "s3cret-token" } },
		}),
	],
	test: {
		setupFiles: ["./test/apply-migrations.ts"],
		coverage: { provider: "istanbul", include: ["src/**", "scripts/**"], reporter: ["text", "text-summary"] },
	},
});
