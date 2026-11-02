-- Deletes return_date_change rows recorded when ANSM only reworded an unchanged expected return
-- ("prévue X" -> "prévue : X."): the two texts are equal once lowercased (ASCII only in SQLite) and stripped of
-- spaces, tab, LF, CR, U+00A0, U+2009, U+202F and . : ; , (the comparison applyDiff uses).
DELETE FROM status_history
WHERE change_type = 'return_date_change'
	AND replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(old_expected_return), ' ', ''), char(9), ''), char(10), ''), char(13), ''), char(160), ''), char(8201), ''), char(8239), ''), '.', ''), ':', ''), ';', ''), ',', '')
		= replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(new_expected_return), ' ', ''), char(9), ''), char(10), ''), char(13), ''), char(160), ''), char(8201), ''), char(8239), ''), '.', ''), ':', ''), ';', ''), ',', '');
