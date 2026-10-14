-- ============================================================
-- Equipment Sign-Out Sheet — follow-up migration 2:
--   1. Numbers out/back (e.g. bib numbers) + reconciled tick,
--      per equipment type per event.
--   2. Packed By / Checked By, for both the OUT and BACK IN
--      sections of the sign-off footer.
-- Safe to run multiple times (IF NOT EXISTS on every column).
-- ============================================================

alter table event_equipment_verification
  add column if not exists numbers_out text,
  add column if not exists numbers_back text,
  add column if not exists numbers_reconciled boolean not null default false;

alter table event_equipment_signoff
  add column if not exists packed_out_name text,
  add column if not exists packed_out_id_number text,
  add column if not exists packed_out_job_title text,
  add column if not exists checked_out_name text,
  add column if not exists checked_out_id_number text,
  add column if not exists checked_out_job_title text,
  add column if not exists packed_back_name text,
  add column if not exists packed_back_id_number text,
  add column if not exists packed_back_job_title text,
  add column if not exists checked_back_name text,
  add column if not exists checked_back_id_number text,
  add column if not exists checked_back_job_title text;
