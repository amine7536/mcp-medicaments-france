-- Expected-return text a refetch stopped finding while the entry stayed in rupture or tension.
-- The ingest stores the page as it is (expected_return_raw NULL) and keeps the dropped text here, so the drop
-- records no history row and a returning line is compared against it. NULL whenever expected_return_raw is set.
ALTER TABLE shortages ADD COLUMN expected_return_lost_raw TEXT;
