import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const TABLES = [
	"bdpm_dispo",
	"ingest_runs",
	"medicines",
	"medicines_fts",
	"mitm",
	"shortage_matches",
	"shortages",
	"status_history",
	"substances",
];

describe("schema", () => {
	it("applies the migrations", async () => {
		const { results } = await env.DB.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (" + TABLES.map(() => "?").join(",") + ") ORDER BY name",
		)
			.bind(...TABLES)
			.all<{ name: string }>();
		expect(results.map((row) => row.name)).toEqual(TABLES);
	});

	it("returns an inserted FTS5 row on MATCH", async () => {
		await env.DB.prepare("INSERT INTO medicines_fts (cis, denomination_norm, substances_norm) VALUES (?, ?, ?)")
			.bind("60001234", "ANAPEN 150 MCG/0.3 ML SOLUTION INJECTABLE", "ADRENALINE")
			.run();
		const row = await env.DB.prepare("SELECT cis FROM medicines_fts WHERE medicines_fts MATCH ?")
			.bind("ANAPEN AND 0 AND 3")
			.first<{ cis: string }>();
		expect(row?.cis).toBe("60001234");
	});
});
