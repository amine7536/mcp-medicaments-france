-- Clears detail_hash on listed rows with no scope line or, for rupture/tension, no expected return,
-- so the next ingest refetches their detail page and reads the free-text scope and return lines.
UPDATE shortages SET detail_hash = NULL
WHERE listed = 1
	AND ((scope = 'inconnu' AND scope_raw IS NULL) OR (status IN ('rupture', 'tension') AND expected_return_raw IS NULL));
