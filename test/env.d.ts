declare namespace Cloudflare {
	interface Env {
		TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
		TEST_FIXTURES: Record<string, string>;
	}
}
