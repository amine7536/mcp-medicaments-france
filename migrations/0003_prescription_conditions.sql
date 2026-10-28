-- BDPM: prescription and dispensing conditions of a medicine (cis -> medicines.cis), verbatim, in source order.
-- No foreign key, for the same reason as 0001: BDPM tables are fully replaced every month.
CREATE TABLE prescription_conditions (
	cis TEXT NOT NULL,
	condition TEXT NOT NULL,
	position INTEGER NOT NULL
);
CREATE INDEX idx_prescription_conditions_cis ON prescription_conditions (cis);
