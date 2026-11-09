import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const TABLES = [
	"bdpm_dispo",
	"ingest_runs",
	"medicines",
	"medicines_fts",
	"medicines_trgm",
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

	it("the trigram migration creates and backfills medicines_trgm from medicines_fts, and re-runs without duplicates", async () => {
		const migration = env.TEST_MIGRATIONS.find((m) => m.name === "0006_medicines_trgm.sql");
		if (migration === undefined) throw new Error("migration 0006_medicines_trgm.sql not loaded");
		await env.DB.batch([
			env.DB.prepare("DELETE FROM medicines_fts"),
			env.DB.prepare("INSERT INTO medicines_fts (cis, denomination_norm, substances_norm) VALUES ('60009001', 'DOLIPRANE 1000 MG COMPRIME', 'PARACETAMOL')"),
			env.DB.prepare("DROP TABLE medicines_trgm"),
		]);
		const run = async () => {
			for (const query of migration.queries) await env.DB.prepare(query).run();
		};
		await run();
		await run();
		const { results } = await env.DB.prepare("SELECT cis FROM medicines_trgm WHERE medicines_trgm MATCH ?").bind('"OLI"').all<{ cis: string }>();
		expect(results.map((r) => r.cis)).toEqual(["60009001"]);
	});

	it("the unparsed returns migration clears detail_hash on listed unparsed rows other than indéterminée", async () => {
		const migration = env.TEST_MIGRATIONS.find((m) => m.name === "0007_refetch_unparsed_returns.sql");
		if (migration === undefined) throw new Error("migration 0007_refetch_unparsed_returns.sql not loaded");
		const insert = env.DB.prepare(
			`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, expected_return_raw, expected_return_earliest, list_hash, detail_hash, first_seen_at, last_seen_at, listed)
			VALUES (?, '/x', 'X', 'X', 'tension', 'Tension', ?, ?, 'h', 'd', '2026-10-01', '2026-10-27', ?)`,
		);
		await env.DB.batch([
			insert.bind("m-season", "Date de remise à disposition prévue : été 2027", null, 1),
			insert.bind("m-typo", "Date de remise à disposition prévue indérminée", null, 1),
			insert.bind("m-undetermined", "Date de remise à disposition prévue indéterminée", null, 1),
			insert.bind("m-parsed", "Date de remise à disposition prévue fin novembre 2026", "2026-11-01", 1),
			insert.bind("m-unlisted", "Date de remise à disposition prévue : été 2027", null, 0),
		]);
		for (const query of migration.queries) await env.DB.prepare(query).run();
		const { results } = await env.DB.prepare("SELECT id, detail_hash FROM shortages WHERE id LIKE 'm-%' ORDER BY id").all<{ id: string; detail_hash: string | null }>();
		expect(results).toEqual([
			{ id: "m-parsed", detail_hash: "d" },
			{ id: "m-season", detail_hash: null },
			{ id: "m-typo", detail_hash: null },
			{ id: "m-undetermined", detail_hash: "d" },
			{ id: "m-unlisted", detail_hash: "d" },
		]);
	});
});
