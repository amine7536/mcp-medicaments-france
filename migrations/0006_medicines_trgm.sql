-- Trigram index over the normalized names and substances (cis -> medicines.cis), used for misspelled name queries.
-- Idempotent: the BDPM import runs the same CREATE, so it works whether or not this migration ran first.
CREATE VIRTUAL TABLE IF NOT EXISTS medicines_trgm USING fts5(cis UNINDEXED, denomination_norm, substances_norm, tokenize='trigram');
DELETE FROM medicines_trgm;
INSERT INTO medicines_trgm (cis, denomination_norm, substances_norm) SELECT cis, denomination_norm, substances_norm FROM medicines_fts;
