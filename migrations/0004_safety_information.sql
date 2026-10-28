-- BDPM: ANSM safety information attached to a medicine (cis -> medicines.cis): title and link of the ANSM page, validity window.
-- No foreign key, for the same reason as 0001: BDPM tables are fully replaced on every import.
CREATE TABLE safety_information (
	cis TEXT NOT NULL,
	title TEXT NOT NULL,
	url TEXT NOT NULL,
	starts_on TEXT NOT NULL,
	ends_on TEXT NOT NULL
);
CREATE INDEX idx_safety_information_cis ON safety_information (cis);
