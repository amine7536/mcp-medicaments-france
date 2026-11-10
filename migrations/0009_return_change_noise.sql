-- Keeps the expected return a refetch stopped finding: on listed rupture/tension rows with no stored return,
-- copies the old text of the latest return_date_change when that row went from a text other than undetermined to NULL.
-- Runs before the delete below, which removes that history row.
UPDATE shortages
SET expected_return_lost_raw = (
	SELECT h.old_expected_return FROM status_history h
	WHERE h.id = (SELECT MAX(l.id) FROM status_history l WHERE l.shortage_id = shortages.id AND l.change_type = 'return_date_change')
)
WHERE listed = 1
	AND status IN ('rupture', 'tension')
	AND expected_return_raw IS NULL
	AND EXISTS (
		SELECT 1 FROM status_history h
		WHERE h.id = (SELECT MAX(l.id) FROM status_history l WHERE l.shortage_id = shortages.id AND l.change_type = 'return_date_change')
			AND h.new_expected_return IS NULL
			AND h.old_expected_return IS NOT NULL
			AND h.old_expected_return NOT LIKE '%ind_termin_%'
			AND h.old_expected_return NOT LIKE '%ind_rmin_%'
	);

-- Deletes the return_date_change rows the ingest no longer writes: a NULL new text (a dropped return line, or
-- undetermined to nothing), or an undetermined new text whose old text is NULL or undetermined.
-- Undetermined is LIKE '%ind_termin_%' or '%ind_rmin_%' ("indérminée" typo), any accent, ASCII case folded.
DELETE FROM status_history
WHERE change_type = 'return_date_change'
	AND (
		new_expected_return IS NULL
		OR (
			(new_expected_return LIKE '%ind_termin_%' OR new_expected_return LIKE '%ind_rmin_%')
			AND (old_expected_return IS NULL OR old_expected_return LIKE '%ind_termin_%' OR old_expected_return LIKE '%ind_rmin_%')
		)
	);
