-- ============================================================
-- IMPI Deployment — Posting Sheet & Pay Run
-- Run this entire file once in Supabase SQL Editor (new project)
-- ============================================================

-- 1. Master Officer Types (single source of truth — replaces the
--    two drifting Rate Cards from the old Excel workbooks)
create table officer_types (
  id uuid primary key default gen_random_uuid(),
  type_name text not null unique,
  psira_grade text not null default 'N/A',   -- e.g. 'Gr A', 'Gr B', 'Gr C', 'N/A'
  sell_price numeric(10,2) not null default 0,   -- charged to client (per shift)
  pay_rate numeric(10,2) not null default 0,     -- paid to supplier/guard (per shift)
  created_at timestamptz not null default now()
);

-- 2. Master Officer Roster (reusable across events)
create table officers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  id_number text,
  psira_number text,
  psira_grade text,        -- officer's own registered grade
  bib_serial text,          -- card/BIB serial number (can change per event, but default lives here)
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

-- 3. Events
create table events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  venue text,
  event_date text,          -- overview date, display string (e.g. "08 August 2026")
  timing text,               -- overview timing, display string (e.g. "11:00 - 19:00")
  quotation_ref text,
  status text not null default 'draft',  -- draft | posted | closed
  created_at timestamptz not null default now()
);

-- 4. Quote Line Items — parsed from the uploaded quotation Builder sheet
create table quote_line_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  row_type text not null,             -- 'SECTION HEADER' | 'LINE ITEM'
  sort_order integer not null,
  category text,                      -- e.g. 'PARKING'
  item_date text,
  shift_name text,
  start_time text,
  end_time text,
  section_text text,                  -- pre-built heading sentence for SECTION HEADER rows
  qty integer default 0,
  officer_type_name text,             -- text match against officer_types.type_name
  posting_location text,              -- e.g. 'Main Parking'
  shifts numeric(6,2) default 1,      -- multiplier used by pay run
  created_at timestamptz not null default now()
);

-- 5. Posting Slots — one row PER OFFICER POSITION (qty already expanded).
--    This is what the Posting Sheet and Pay Run both render from, so they
--    can never drift out of sync with each other.
create table posting_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  line_item_id uuid not null references quote_line_items(id) on delete cascade,
  slot_index integer not null,        -- 1..qty within that line item
  sort_order integer not null,        -- overall display order across the whole posting sheet

  officer_id uuid references officers(id),
  first_name text,
  last_name text,
  id_number text,
  psira_number text,
  bib_serial text,

  special_events boolean not null default false,
  status text not null default 'vacant',   -- vacant | assigned | checked_in | checked_out
  time_in timestamptz,
  time_out timestamptz,
  signature_data text,                -- base64 signature capture, optional

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_quote_line_items_event on quote_line_items(event_id, sort_order);
create index idx_posting_slots_event on posting_slots(event_id, sort_order);

-- ============================================================
-- Row Level Security — internal single-tenant tool.
-- Any authenticated IMPI staff member (magic-link login) gets
-- full access. Adjust later if you need per-role restrictions.
-- ============================================================
alter table officer_types enable row level security;
alter table officers enable row level security;
alter table events enable row level security;
alter table quote_line_items enable row level security;
alter table posting_slots enable row level security;

create policy "authenticated full access" on officer_types
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on officers
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on events
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on quote_line_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on posting_slots
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- Seed: starter Officer Types — EDIT these to match your real
-- rate card (values below are placeholders from your workbook).
-- ============================================================
insert into officer_types (type_name, psira_grade, sell_price, pay_rate) values
  ('Event Security Manager', 'Gr A', 1550, 550),
  ('Event Safety Officer', 'N/A', 2150, 750),
  ('Event Security Supervisor', 'Gr B', 1080, 480),
  ('Event Security Officer', 'Gr C', 870, 380),
  ('Event Reaction Officer', 'Gr C', 1350, 650),
  ('Event Reaction Officer - Men in Black', 'Gr A', 1450, 650),
  ('Event Cleaner Supervisor', 'N/A', 1080, 480),
  ('Event Cleaner', 'N/A', 870, 380);
