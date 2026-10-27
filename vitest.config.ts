import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const TEST_MIGRATIONS = await readD1Migrations("./migrations");

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: { bindings: { TEST_MIGRATIONS } },
		}),
	],
	test: {
		setupFiles: ["./test/apply-migrations.ts"],
	},
});
