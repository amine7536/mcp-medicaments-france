-- BDPM: latest HAS Transparency Committee opinions (SMR, ASMR) of a medicine (cis -> medicines.cis), without their label text, and the HAS opinion page of each single-page dossier.
-- No foreign key, for the same reason as 0001: BDPM tables are fully replaced on every import.
-- Idempotent: the BDPM import runs the same statements, so it works whether or not this migration ran first.
CREATE TABLE IF NOT EXISTS has_opinions (cis TEXT NOT NULL, kind TEXT NOT NULL, dossier TEXT NOT NULL, motif TEXT NOT NULL, opinion_date TEXT NOT NULL, value TEXT NOT NULL, position INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_has_opinions_cis ON has_opinions (cis);
CREATE TABLE IF NOT EXISTS has_ct_links (dossier TEXT PRIMARY KEY, url TEXT NOT NULL);
