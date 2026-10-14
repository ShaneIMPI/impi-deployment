-- ============================================================
-- Equipment Sign-Out Sheet — additive migration
-- Run this entire file once in the Supabase SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT guards).
-- Does NOT touch any existing table's existing columns or data.
-- ============================================================

-- 1. Tag each section with WHEN it happens and WHAT KIND of posting it
--    is, so equipment rules can key off this instead of guessing from
--    free-text category labels. Defaults keep every existing section
--    working exactly as before until Shane edits a section on the
--    Posting Sheet.
alter table quote_line_items
  add column if not exists phase text not null default 'event_day';
alter table quote_line_items
  add column if not exists posting_category text not null default 'general';

-- 2. Equipment Catalog — the full, extensible list of equipment types
--    available to hand out (Shane manages this list from the app; no
--    code changes needed to add/remove an item).
create table if not exists equipment_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_make text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 3. Equipment Rules — the configurable defaults: for a given event
--    PHASE + POSTING CATEGORY, which equipment items are automatically
--    issued per officer, and how many. Shane edits these from the
--    Equipment Settings page — no code changes needed.
create table if not exists equipment_rules (
  id uuid primary key default gen_random_uuid(),
  phase text not null,              -- 'build_up' | 'breakdown' | 'event_day'
  posting_category text not null,  -- 'parking_street' | 'general'
  equipment_item_id uuid not null references equipment_catalog(id) on delete cascade,
  qty_per_officer integer not null default 1,
  created_at timestamptz not null default now(),
  unique (phase, posting_category, equipment_item_id)
);

-- 4. Event Equipment Items — the actual sign-out rows for one event.
--    Rows with a posting_slot_id are per-officer (generated automatically
--    from the rules whenever Shane hits "Sync from Posting Sheet", and
--    kept in sync as officers/sections change). Rows with no
--    posting_slot_id are whole-event items Shane adds manually (e.g.
--    Gazebo x2, Wheelie Bins x4) that aren't tied to a single officer.
create table if not exists event_equipment_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  equipment_item_id uuid not null references equipment_catalog(id) on delete cascade,
  posting_slot_id uuid references posting_slots(id) on delete cascade,
  officer_label text,               -- snapshot of officer name, for display even if the slot is later removed
  qty integer not null default 1,
  source text not null default 'manual',  -- 'rule' | 'manual'
  created_at timestamptz not null default now()
);
create index if not exists idx_event_equipment_items_event on event_equipment_items(event_id);
create index if not exists idx_event_equipment_items_slot on event_equipment_items(posting_slot_id);

-- 5. Verification — tick-off per equipment type per event (mirrors the
--    "VERIFIED" column on the paper sign-out sheet).
create table if not exists event_equipment_verification (
  event_id uuid not null references events(id) on delete cascade,
  equipment_item_id uuid not null references equipment_catalog(id) on delete cascade,
  verified boolean not null default false,
  verified_at timestamptz,
  primary key (event_id, equipment_item_id)
);

-- 6. Sign-out / sign-back-in footer (mirrors the paper sheet's bottom
--    section) — one row per event, optional, free text.
create table if not exists event_equipment_signoff (
  event_id uuid primary key references events(id) on delete cascade,
  signed_out_name text,
  signed_out_id_number text,
  signed_out_job_title text,
  signed_back_name text,
  signed_back_id_number text,
  signed_back_job_title text,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security — same pattern as the rest of the app:
-- any authenticated IMPI staff member has full access; emails listed
-- in viewer_emails get read-only access.
-- ============================================================
alter table equipment_catalog enable row level security;
alter table equipment_rules enable row level security;
alter table event_equipment_items enable row level security;
alter table event_equipment_verification enable row level security;
alter table event_equipment_signoff enable row level security;

create policy "read all authenticated" on equipment_catalog
  for select using (auth.role() = 'authenticated');
create policy "write non-viewers" on equipment_catalog
  for insert with check (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));
create policy "update non-viewers" on equipment_catalog
  for update using (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));
create policy "delete non-viewers" on equipment_catalog
  for delete using (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));

create policy "read all authenticated" on equipment_rules
  for select using (auth.role() = 'authenticated');
create policy "write non-viewers" on equipment_rules
  for insert with check (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));
create policy "update non-viewers" on equipment_rules
  for update using (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));
create policy "delete non-viewers" on equipment_rules
  for delete using (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));

create policy "read all authenticated" on event_equipment_items
  for select using (auth.role() = 'authenticated');
create policy "write non-viewers" on event_equipment_items
  for insert with check (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));
create policy "update non-viewers" on event_equipment_items
  for update using (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));
create policy "delete non-viewers" on event_equipment_items
  for delete using (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));

create policy "read all authenticated" on event_equipment_verification
  for select using (auth.role() = 'authenticated');
create policy "write non-viewers" on event_equipment_verification
  for insert with check (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));
create policy "update non-viewers" on event_equipment_verification
  for update using (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));
create policy "delete non-viewers" on event_equipment_verification
  for delete using (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));

create policy "read all authenticated" on event_equipment_signoff
  for select using (auth.role() = 'authenticated');
create policy "write non-viewers" on event_equipment_signoff
  for insert with check (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));
create policy "update non-viewers" on event_equipment_signoff
  for update using (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));
create policy "delete non-viewers" on event_equipment_signoff
  for delete using (auth.role() = 'authenticated' and not exists (select 1 from viewer_emails where email = auth.email()));

-- ============================================================
-- Seed: starter Equipment Catalog, taken from the AAXO Awards
-- reference sign-out sheet, plus Pullovers (used for Event Day
-- postings that aren't Parking/Street). Edit/add to this list any
-- time from the Equipment Settings page in the app.
-- ============================================================
insert into equipment_catalog (name, default_make, sort_order) values
  ('Radios', 'Halo', 10),
  ('Earpieces', 'Unknown', 20),
  ('Radio Batteries', 'Halo', 30),
  ('Pullovers', 'IMPI', 40),
  ('Normal Guard Bibs', 'IMPI', 50),
  ('Supervisor Bibs', 'IMPI', 60),
  ('Reaction Bibs', 'IMPI', 70),
  ('Traffic Cones', 'N/A', 80),
  ('Gazebo', 'IMPI', 90),
  ('Clicker Counters', 'N/A', 100),
  ('Wheelie Bins', 'N/A', 110),
  ('Battery Chargers', 'Halo', 120),
  ('Event Cleaner Shirts', 'BBS', 130),
  ('Event Cleaner Gloves', 'BBS', 140),
  ('Refuse Bags', 'N/A', 150),
  ('IMPI Name Tags', 'IMPI', 160),
  ('IMPI MIB Tie', 'IMPI', 170),
  ('Torches', 'Magneto', 180)
on conflict (name) do nothing;

-- ============================================================
-- Seed: starter Equipment Rules, matching Shane's stated business
-- rule exactly — edit/add to these any time from the Equipment
-- Settings page:
--   Event Day, general postings        -> 1 Pullover per officer
--   Event Day, Parking/Street postings -> 1 Normal Guard Bib per officer
--   Build-Up,  any posting             -> 1 Normal Guard Bib per officer
--   Breakdown, any posting             -> 1 Normal Guard Bib per officer
-- ============================================================
insert into equipment_rules (phase, posting_category, equipment_item_id, qty_per_officer)
select 'event_day', 'general', id, 1 from equipment_catalog where name = 'Pullovers'
on conflict (phase, posting_category, equipment_item_id) do nothing;

insert into equipment_rules (phase, posting_category, equipment_item_id, qty_per_officer)
select 'event_day', 'parking_street', id, 1 from equipment_catalog where name = 'Normal Guard Bibs'
on conflict (phase, posting_category, equipment_item_id) do nothing;

insert into equipment_rules (phase, posting_category, equipment_item_id, qty_per_officer)
select 'build_up', 'general', id, 1 from equipment_catalog where name = 'Normal Guard Bibs'
on conflict (phase, posting_category, equipment_item_id) do nothing;

insert into equipment_rules (phase, posting_category, equipment_item_id, qty_per_officer)
select 'build_up', 'parking_street', id, 1 from equipment_catalog where name = 'Normal Guard Bibs'
on conflict (phase, posting_category, equipment_item_id) do nothing;

insert into equipment_rules (phase, posting_category, equipment_item_id, qty_per_officer)
select 'breakdown', 'general', id, 1 from equipment_catalog where name = 'Normal Guard Bibs'
on conflict (phase, posting_category, equipment_item_id) do nothing;

insert into equipment_rules (phase, posting_category, equipment_item_id, qty_per_officer)
select 'breakdown', 'parking_street', id, 1 from equipment_catalog where name = 'Normal Guard Bibs'
on conflict (phase, posting_category, equipment_item_id) do nothing;
