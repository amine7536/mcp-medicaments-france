-- Window of the expected return a refetch stopped finding, stored with expected_return_lost_raw so a returning line
-- is compared by window as well as by text. NULL whenever expected_return_lost_raw is NULL.
ALTER TABLE shortages ADD COLUMN expected_return_lost_earliest TEXT;
ALTER TABLE shortages ADD COLUMN expected_return_lost_latest TEXT;
ALTER TABLE shortages ADD COLUMN expected_return_lost_precision TEXT;
ALTER TABLE shortages ADD COLUMN expected_return_lost_part TEXT;
-- Clears detail_hash on listed rupture/tension rows the hand-written patterns left without a scope, without a return,
-- or with an unparsed return other than indéterminée, so the next ingest re-reads their page with the model.
UPDATE shortages SET detail_hash = NULL
WHERE listed = 1
	AND status IN ('rupture', 'tension')
	AND (scope = 'inconnu' OR expected_return_raw IS NULL OR (expected_return_earliest IS NULL AND expected_return_raw NOT LIKE '%indétermin%'));
