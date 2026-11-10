-- Deletes the return_date_change rows a parser upgrade wrote for a return line already on the page: a NULL old
-- return, detected on or after 2026-11-10, on an entry whose page ANSM last updated before the UTC date of the last
-- ok ANSM run started before the detecting run (that run already read the page with the line on it).
-- A NULL ansm_updated_at, a missing shortages row or no earlier ok run keeps the row.
DELETE FROM status_history
WHERE change_type = 'return_date_change'
	AND old_expected_return IS NULL
	AND detected_at >= '2026-11-10'
	AND EXISTS (
		SELECT 1 FROM shortages s
		WHERE s.id = status_history.shortage_id
			AND s.ansm_updated_at < substr(
				(
					SELECT MAX(r.started_at) FROM ingest_runs r
					WHERE r.source = 'ansm' AND r.status = 'ok' AND r.started_at < status_history.detected_at
				),
				1,
				10
			)
	);
