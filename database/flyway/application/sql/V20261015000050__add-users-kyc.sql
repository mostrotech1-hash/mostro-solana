-- KYC is done off-chain with Sumsub (no on-chain KYC). The API stores only the result, never the documents.
ALTER TABLE mostro_app.users
    ADD COLUMN kyc_status text NOT NULL DEFAULT 'none'
        CHECK (kyc_status IN ('none', 'pending', 'approved', 'rejected')),
    ADD COLUMN sumsub_applicant_id text UNIQUE,
    ADD COLUMN kyc_updated_at timestamptz;
