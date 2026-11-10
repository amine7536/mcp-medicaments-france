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

	it("the return change noise migration keeps dropped returns and deletes undetermined and dropped return changes", async () => {
		const migration = env.TEST_MIGRATIONS.find((m) => m.name === "0009_return_change_noise.sql");
		if (migration === undefined) throw new Error("migration 0009_return_change_noise.sql not loaded");
		const undet = "Date de remise à disposition prévue indéterminée.";
		const dated = "Remise à disposition prévue fin décembre 2026.";
		const insertShortage = env.DB.prepare(
			`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, expected_return_raw, list_hash, first_seen_at, last_seen_at, listed)
			VALUES (?, '/x', 'X', 'X', 'tension', 'Tension', NULL, 'h', '2026-10-01', '2026-10-27', ?)`,
		);
		const insertHistory = env.DB.prepare(
			"INSERT INTO status_history (shortage_id, change_type, old_expected_return, new_expected_return, detected_at) VALUES (?, ?, ?, ?, '2026-11-06')",
		);
		const rdc = (id: string, from: string | null, to: string | null) => insertHistory.bind(id, "return_date_change", from, to);
		await env.DB.batch([
			insertShortage.bind("b-lost", 1),
			insertShortage.bind("b-delisted", 0),
			insertShortage.bind("b-undetermined", 1),
			insertShortage.bind("b-returned", 1),
			rdc("b-lost", dated, null),
			rdc("b-delisted", dated, null),
			rdc("b-undetermined", undet, null),
			rdc("b-returned", dated, null),
			rdc("b-returned", null, dated),
			rdc("d-undetermined", undet, "Date de remise à disposition indéterminée."),
			rdc("d-uppercase", "DATE DE REMISE A DISPOSITION PREVUE INDETERMINEE", undet),
			rdc("d-typo", "Date de remise à disposition prévue : indérminée.", undet),
			rdc("d-null-undetermined", null, undet),
			rdc("d-undetermined-null", undet, null),
			rdc("d-dated-null", dated, null),
			rdc("d-unparsed-null", "Remise à disposition prévue prochainement", null),
			rdc("k-undetermined-dated", undet, dated),
			rdc("k-dated-undetermined", dated, undet),
			rdc("k-null-dated", null, dated),
			rdc("k-dated-dated", "Remise à disposition prévue fin novembre 2026.", dated),
			insertHistory.bind("k-status", "status_change", null, null),
		]);
		for (const query of migration.queries) await env.DB.prepare(query).run();

		const { results: lost } = await env.DB.prepare("SELECT id, expected_return_lost_raw AS lost FROM shortages WHERE id LIKE 'b-%' ORDER BY id").all();
		expect(lost).toEqual([
			{ id: "b-delisted", lost: null },
			{ id: "b-lost", lost: dated },
			{ id: "b-returned", lost: null },
			{ id: "b-undetermined", lost: null },
		]);
		const { results: kept } = await env.DB.prepare("SELECT shortage_id, change_type FROM status_history ORDER BY id").all();
		expect(kept).toEqual([
			{ shortage_id: "b-returned", change_type: "return_date_change" },
			{ shortage_id: "k-undetermined-dated", change_type: "return_date_change" },
			{ shortage_id: "k-dated-undetermined", change_type: "return_date_change" },
			{ shortage_id: "k-null-dated", change_type: "return_date_change" },
			{ shortage_id: "k-dated-dated", change_type: "return_date_change" },
			{ shortage_id: "k-status", change_type: "status_change" },
		]);
	});
});
