-- Relationships are documented in comments only: BDPM tables are fully
-- replaced every month and D1 enforces foreign keys by default.

-- BDPM: one row per medicine (CIS).
CREATE TABLE medicines (
	cis TEXT PRIMARY KEY,
	denomination TEXT NOT NULL,
	denomination_norm TEXT NOT NULL,
	form TEXT,
	routes TEXT,
	amm_status TEXT,
	marketing_status TEXT,
	holder TEXT,
	bdpm_updated_at TEXT NOT NULL
);

-- BDPM: active substances of a medicine (cis -> medicines.cis).
CREATE TABLE substances (
	cis TEXT NOT NULL,
	substance_code TEXT,
	substance_name TEXT NOT NULL,
	substance_norm TEXT NOT NULL,
	dosage TEXT,
	nature TEXT -- SA (only SA rows imported)
);
CREATE INDEX idx_substances_cis ON substances (cis);
CREATE INDEX idx_substances_substance_norm ON substances (substance_norm);

-- BDPM: medicines of major therapeutic interest (cis -> medicines.cis).
CREATE TABLE mitm (
	cis TEXT PRIMARY KEY,
	atc_code TEXT NOT NULL
);

-- Full-text search over normalized names (cis -> medicines.cis).
CREATE VIRTUAL TABLE medicines_fts USING fts5(
	cis UNINDEXED,
	denomination_norm,
	substances_norm
);

-- BDPM: availability records (cis -> medicines.cis, ansm_path -> shortages.ansm_path).
CREATE TABLE bdpm_dispo (
	cis TEXT NOT NULL,
	cip13 TEXT,
	status_code INTEGER NOT NULL,
	status_label TEXT NOT NULL,
	date_debut TEXT,
	date_maj TEXT,
	date_remise TEXT,
	ansm_path TEXT NOT NULL
);
CREATE INDEX idx_bdpm_dispo_ansm_path ON bdpm_dispo (ansm_path);
CREATE INDEX idx_bdpm_dispo_cis ON bdpm_dispo (cis);

-- ANSM: one row per shortage entry.
CREATE TABLE shortages (
	id TEXT PRIMARY KEY, -- ANSM data-id
	ansm_path TEXT NOT NULL, -- e.g. /disponibilites-des-produits-de-sante/medicaments/<slug>
	raw_name TEXT NOT NULL, -- name part as published (before " – [")
	raw_name_norm TEXT NOT NULL,
	dci_raw TEXT,
	status TEXT NOT NULL, -- rupture|tension|remise_a_disposition|arret_commercialisation|autre
	status_raw TEXT NOT NULL, -- ANSM label as published
	scope TEXT NOT NULL DEFAULT 'inconnu', -- ville|hopital|ville_hopital|inconnu
	scope_raw TEXT,
	expected_return_earliest TEXT,
	expected_return_latest TEXT,
	expected_return_precision TEXT, -- day|month|quarter|year
	expected_return_part TEXT, -- debut|mi|fin
	expected_return_raw TEXT,
	returned_at TEXT,
	situation_start TEXT,
	therapeutic_areas TEXT,
	therapeutic_areas_norm TEXT,
	ansm_published_at TEXT,
	ansm_detail_updated_at TEXT,
	ansm_updated_at TEXT,
	list_hash TEXT NOT NULL,
	detail_hash TEXT,
	first_seen_at TEXT NOT NULL,
	last_seen_at TEXT NOT NULL,
	missed_runs INTEGER NOT NULL DEFAULT 0,
	listed INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_shortages_status_listed ON shortages (status, listed);
CREATE INDEX idx_shortages_ansm_updated_at ON shortages (ansm_updated_at);
CREATE INDEX idx_shortages_ansm_path ON shortages (ansm_path);

-- Shortage to medicine matches (shortage_id -> shortages.id, cis -> medicines.cis).
CREATE TABLE shortage_matches (
	shortage_id TEXT NOT NULL,
	cis TEXT NOT NULL,
	method TEXT NOT NULL, -- manual|dispo|exact|fuzzy
	confidence REAL NOT NULL,
	is_best INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (shortage_id, cis)
);
CREATE INDEX idx_shortage_matches_cis ON shortage_matches (cis);

-- Change log per shortage (shortage_id -> shortages.id).
CREATE TABLE status_history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	shortage_id TEXT NOT NULL,
	change_type TEXT NOT NULL, -- new|status_change|return_date_change|delisted|relisted
	old_status TEXT,
	new_status TEXT,
	old_expected_return TEXT, -- raw text
	new_expected_return TEXT, -- raw text
	detected_at TEXT NOT NULL
);
CREATE INDEX idx_status_history_detected_at ON status_history (detected_at);
CREATE INDEX idx_status_history_shortage_id ON status_history (shortage_id);

-- Ingest run log.
CREATE TABLE ingest_runs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	source TEXT NOT NULL, -- ansm|bdpm
	started_at TEXT NOT NULL,
	finished_at TEXT,
	status TEXT NOT NULL, -- running|ok|aborted|error
	entries_seen INTEGER,
	entries_new INTEGER,
	entries_changed INTEGER,
	entries_delisted INTEGER,
	bdpm_release TEXT,
	message TEXT
);
CREATE INDEX idx_ingest_runs_source_status_started_at ON ingest_runs (source, status, started_at);
