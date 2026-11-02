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

	it("the return wording cleanup deletes punctuation-only return_date_change rows and keeps real ones", async () => {
		const migration = env.TEST_MIGRATIONS.find((m) => m.name === "0005_return_wording_cleanup.sql");
		if (migration === undefined) throw new Error("migration 0005_return_wording_cleanup.sql not loaded");
		const insert = env.DB.prepare(
			"INSERT INTO status_history (shortage_id, change_type, old_status, new_status, old_expected_return, new_expected_return, detected_at) VALUES (?, 'return_date_change', 'tension', 'tension', ?, ?, '2026-10-31T05:00:30.065Z') RETURNING id",
		);
		const reworded = await insert
			.bind("t-1035", "Date de remise à disposition prévue indéterminée", "Date de remise à disposition prévue : indéterminée.")
			.first<number>("id");
		const changed = await insert
			.bind("t-1492", "Date de remise à disposition prévue fin octobre 2026.", "Date de remise à disposition prévue : fin novembre 2026.")
			.first<number>("id");
		for (const query of migration.queries) await env.DB.prepare(query).run();
		const { results } = await env.DB.prepare("SELECT id FROM status_history WHERE id IN (?, ?)").bind(reworded, changed).all<{ id: number }>();
		expect(results.map((r) => r.id)).toEqual([changed]);
	});
});
