declare namespace Cloudflare {
	interface Env {
		TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
		TEST_FIXTURES: Record<string, string>;
		TEST_OBSERVABILITY: NonNullable<import("wrangler").Unstable_RawConfig["observability"]>;
	}
}

declare module "*?raw" {
	const content: string;
	export default content;
}
