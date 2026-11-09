-- Clears detail_hash on listed rows whose expected return was stored unparsed (other than "indéterminée"),
-- so the next ingest refetches their detail page and stores the current parse.
UPDATE shortages SET detail_hash = NULL
WHERE listed = 1
	AND expected_return_earliest IS NULL
	AND expected_return_raw IS NOT NULL
	AND expected_return_raw NOT LIKE '%indétermin%';
