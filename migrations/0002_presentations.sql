-- BDPM: one row per presentation (box) of a medicine (cis -> medicines.cis).
-- No foreign key, for the same reason as 0001: BDPM tables are fully replaced every month.
CREATE TABLE presentations (
	cip13 TEXT PRIMARY KEY,
	cip7 TEXT,
	cis TEXT NOT NULL,
	label TEXT NOT NULL,
	admin_status TEXT,
	marketing_status TEXT,
	declared_at TEXT,
	hospital_approval INTEGER, -- 1 oui, 0 non, NULL otherwise
	reimbursement_rates TEXT, -- JSON array of integers, e.g. [65] or [100,65]; NULL when empty
	price_eur REAL,
	public_price_eur REAL,
	dispensing_fee_eur REAL,
	reimbursement_indications TEXT
);
CREATE INDEX idx_presentations_cis ON presentations (cis);
