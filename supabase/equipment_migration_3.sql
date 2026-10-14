-- ============================================================
-- Equipment Sign-Out Sheet — follow-up migration 3:
--   Officer-type-aware equipment rules + correct quantity logic.
--
-- What changes in the app once this is run:
--   1. Each Auto-Issue Rule can now be tied to one specific Officer
--      Type (e.g. "Marshal Bib" only for Marshals, "Supervisor Bib"
--      only for Supervisors). Leave Officer Type blank on a rule for
--      it to apply to every officer type — this is how Pullovers
--      (worn by everyone, but only on Event Day) keep working.
--   2. Cleaning equipment becomes automatic: tie a rule's Officer
--      Type to your cleaner role (e.g. "Event Cleaner") and it will
--      only ever appear on the sign-out sheet for events that
--      actually have a cleaner posted — no cleaners on the Posting
--      Sheet, no cleaning gear listed.
--   3. Quantities are no longer summed across every day/section.
--      Equipment is now packed once per phase (Build-Up, Breakdown,
--      Event Day) at the HIGHEST single-day/single-section count
--      for that phase, then reused — exactly as kit is reused on
--      site across multiple days.
--
-- Safe to run multiple times.
-- ============================================================

alter table equipment_rules
  add column if not exists officer_type_name text;

-- Replace the old unique constraint (which didn't know about officer
-- type) with one that does. NULL/blank officer_type_name is treated
-- as its own single value here (via coalesce) so you can't
-- accidentally create two "applies to everyone" rules for the same
-- phase/category/equipment combo.
alter table equipment_rules drop constraint if exists equipment_rules_phase_posting_category_equipment_item_id_key;

drop index if exists equipment_rules_unique_combo;
create unique index equipment_rules_unique_combo
  on equipment_rules (phase, posting_category, equipment_item_id, coalesce(officer_type_name, ''));
