-- Composition of a medicine (cis -> medicines.cis): each active substance (SA) with its reference and its linked therapeutic fractions (FT) as JSON.
-- Idempotent: the BDPM import runs the same statements, so it works whether or not this migration ran first.
CREATE TABLE IF NOT EXISTS composition (cis TEXT NOT NULL, substance_name TEXT NOT NULL, dosage TEXT, reference TEXT, therapeutic_fractions TEXT);
CREATE INDEX IF NOT EXISTS idx_composition_cis ON composition (cis);
