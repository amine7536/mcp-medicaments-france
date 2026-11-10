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

	it("the free-text observations migration clears detail_hash on listed rows with no scope line or no return", async () => {
		const migration = env.TEST_MIGRATIONS.find((m) => m.name === "0010_refetch_free_text_observations.sql");
		if (migration === undefined) throw new Error("migration 0010_refetch_free_text_observations.sql not loaded");
		const insert = env.DB.prepare(
			`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, scope, scope_raw, expected_return_raw, list_hash, detail_hash, first_seen_at, last_seen_at, listed)
			VALUES (?, '/x', 'X', 'X', ?, 'S', ?, ?, ?, 'h', 'd', '2026-10-01', '2026-11-09', ?)`,
		);
		const situation = "Situation en ville : non impacté";
		const dated = "Date de remise à disposition prévue fin 2026";
		await env.DB.batch([
			insert.bind("f-inconnu-no-return", "tension", "inconnu", null, null, 1),
			insert.bind("f-ville-no-return", "tension", "ville", "Situation en ville : tension", null, 1),
			insert.bind("f-remise-inconnu", "remise_a_disposition", "inconnu", null, null, 1),
			insert.bind("f-situation-return", "tension", "inconnu", situation, dated, 1),
			insert.bind("f-ville-return", "tension", "ville", "Situation en ville : tension", dated, 1),
			insert.bind("f-delisted", "tension", "inconnu", null, null, 0),
		]);
		for (const query of migration.queries) await env.DB.prepare(query).run();
		const { results } = await env.DB.prepare("SELECT id, detail_hash FROM shortages WHERE id LIKE 'f-%' ORDER BY id").all<{ id: string; detail_hash: string | null }>();
		expect(results).toEqual([
			{ id: "f-delisted", detail_hash: "d" },
			{ id: "f-inconnu-no-return", detail_hash: null },
			{ id: "f-remise-inconnu", detail_hash: null },
			{ id: "f-situation-return", detail_hash: "d" },
			{ id: "f-ville-no-return", detail_hash: null },
			{ id: "f-ville-return", detail_hash: "d" },
		]);
	});

	it("the model extraction migration adds the lost window columns and clears detail_hash on rupture/tension rows to re-read", async () => {
		const migration = env.TEST_MIGRATIONS.find((m) => m.name === "0011_refetch_model_extraction.sql");
		if (migration === undefined) throw new Error("migration 0011_refetch_model_extraction.sql not loaded");
		const { results: columns } = await env.DB.prepare("PRAGMA table_info(shortages)").all<{ name: string; type: string }>();
		const lostColumns = ["expected_return_lost_earliest", "expected_return_lost_latest", "expected_return_lost_precision", "expected_return_lost_part"];
		expect(columns.filter((c) => lostColumns.includes(c.name)).map((c) => [c.name, c.type])).toEqual(lostColumns.map((c) => [c, "TEXT"]));

		const insert = env.DB.prepare(
			`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, scope, expected_return_raw, expected_return_earliest, list_hash, detail_hash, first_seen_at, last_seen_at, listed)
			VALUES (?, '/x', 'X', 'X', ?, 'S', ?, ?, ?, 'h', 'd', '2026-10-01', '2026-11-10', ?)`,
		);
		const dated = "Date de remise à disposition prévue fin 2026";
		const unparsed = "Remise à disposition au niveau du/des laboratoires exploitants : fin novembre 2026.";
		const undetermined = "Date de remise à disposition prévue indéterminée";
		await env.DB.batch([
			insert.bind("x-inconnu", "rupture", "inconnu", dated, "2026-01-01", 1),
			insert.bind("x-no-return", "tension", "ville", null, null, 1),
			insert.bind("x-unparsed", "tension", "hopital", unparsed, null, 1),
			insert.bind("x-undetermined", "tension", "ville", undetermined, null, 1),
			insert.bind("x-complete", "rupture", "ville", dated, "2026-01-01", 1),
			insert.bind("x-remise", "remise_a_disposition", "inconnu", null, null, 1),
			insert.bind("x-arret", "arret_commercialisation", "inconnu", null, null, 1),
			insert.bind("x-delisted", "tension", "inconnu", null, null, 0),
		]);
		const update = migration.queries.filter((q) => q.includes("UPDATE shortages"));
		expect(update).toHaveLength(1);
		await env.DB.prepare(update[0] as string).run();
		const { results } = await env.DB.prepare(
			`SELECT id, detail_hash, ${lostColumns.join(", ")} FROM shortages WHERE id LIKE 'x-%' ORDER BY id`,
		).all<Record<string, string | null>>();
		expect(results.map((r) => [r.id, r.detail_hash])).toEqual([
			["x-arret", "d"],
			["x-complete", "d"],
			["x-delisted", "d"],
			["x-inconnu", null],
			["x-no-return", null],
			["x-remise", "d"],
			["x-undetermined", "d"],
			["x-unparsed", null],
		]);
		for (const r of results) for (const c of lostColumns) expect(r[c]).toBeNull();
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

	it("the parser upgrade history migration deletes return changes from null on pages ANSM did not update that day", async () => {
		const migration = env.TEST_MIGRATIONS.find((m) => m.name === "0012_parser_upgrade_history.sql");
		if (migration === undefined) throw new Error("migration 0012_parser_upgrade_history.sql not loaded");
		const r1 = "2026-11-10T05:00:29.000Z";
		const r2 = "2026-11-10T18:45:47.335Z";
		const r3 = "2026-11-12T05:00:30.000Z";
		const dated = "Remise à disposition normale prévue fin 2026";
		const text = "Date de remise à disposition normale inconnue";
		const insertRun = env.DB.prepare("INSERT INTO ingest_runs (source, started_at, status) VALUES ('ansm', ?, 'ok')");
		const insertShortage = env.DB.prepare(
			`INSERT INTO shortages (id, ansm_path, raw_name, raw_name_norm, status, status_raw, list_hash, first_seen_at, last_seen_at, listed, ansm_updated_at)
			VALUES (?, '/x', 'X', 'X', 'tension', 'Tension', 'h', '2026-10-01', '2026-11-10', 1, ?)`,
		);
		const insertHistory = env.DB.prepare(
			"INSERT INTO status_history (shortage_id, change_type, old_expected_return, new_expected_return, detected_at) VALUES (?, ?, ?, ?, ?)",
		);
		const rdc = (id: string, from: string | null, to: string, at: string) => insertHistory.bind(id, "return_date_change", from, to, at);
		await env.DB.batch([
			insertRun.bind(r1),
			insertRun.bind(r2),
			insertRun.bind(r3),
			insertShortage.bind("p-old", "2021-05-19"),
			insertShortage.bind("p-later", "2026-10-26"),
			insertShortage.bind("p-sameday", "2026-11-10"),
			insertShortage.bind("p-cron", "2026-11-11"),
			insertShortage.bind("p-afterdetect", "2026-11-12"),
			insertShortage.bind("p-nonnull", "2021-05-19"),
			insertShortage.bind("p-early", "2021-05-19"),
			insertShortage.bind("p-norun", "2021-05-19"),
			insertShortage.bind("p-nulldate", null),
			insertShortage.bind("p-new", "2021-05-19"),
			insertShortage.bind("p-status", "2021-05-19"),
			rdc("p-old", null, dated, r2),
			rdc("p-later", null, text, r3),
			rdc("p-sameday", null, dated, r2),
			rdc("p-cron", null, dated, r3),
			rdc("p-afterdetect", null, dated, r2),
			rdc("p-nonnull", "Remise à disposition prévue fin novembre 2026.", dated, r2),
			rdc("p-early", null, dated, "2026-11-09T21:56:27.094Z"),
			rdc("p-norun", null, dated, "2026-11-10T03:00:00.000Z"),
			rdc("p-nulldate", null, dated, r2),
			rdc("p-orphan", null, dated, r2),
			insertHistory.bind("p-new", "new", null, dated, r2),
			insertHistory.bind("p-status", "status_change", null, null, r2),
		]);
		for (const query of migration.queries) await env.DB.prepare(query).run();

		const { results } = await env.DB.prepare("SELECT shortage_id, change_type FROM status_history WHERE shortage_id LIKE 'p-%' ORDER BY id").all();
		expect(results).toEqual([
			{ shortage_id: "p-sameday", change_type: "return_date_change" },
			{ shortage_id: "p-cron", change_type: "return_date_change" },
			{ shortage_id: "p-afterdetect", change_type: "return_date_change" },
			{ shortage_id: "p-nonnull", change_type: "return_date_change" },
			{ shortage_id: "p-early", change_type: "return_date_change" },
			{ shortage_id: "p-norun", change_type: "return_date_change" },
			{ shortage_id: "p-nulldate", change_type: "return_date_change" },
			{ shortage_id: "p-orphan", change_type: "return_date_change" },
			{ shortage_id: "p-new", change_type: "new" },
			{ shortage_id: "p-status", change_type: "status_change" },
		]);
	});
});
