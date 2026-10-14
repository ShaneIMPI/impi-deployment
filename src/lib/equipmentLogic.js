// Single source of truth for the Equipment Sign-Out feature — mirrors
// the convention in postingLogic.js so the Equipment page and any
// future consumer never drift apart.

// Shown on the Posting Sheet (per section) and on Equipment Settings
// (rules grid). Add more phases here later if Shane needs them —
// nothing else in the code needs to change.
export const PHASES = [
  { value: 'build_up', label: 'Build-Up' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'event_day', label: 'Event Day' },
]

export const POSTING_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'parking_street', label: 'Parking / Street' },
]

export function phaseLabel(value) {
  return PHASES.find((p) => p.value === value)?.label || value || 'Event Day'
}

export function postingCategoryLabel(value) {
  return POSTING_CATEGORIES.find((c) => c.value === value)?.label || value || 'General'
}

// Given the full list of equipment_rules rows, returns every rule that
// applies to a section with this phase + posting_category, each with
// qty_per_officer > 0 (a rule with qty 0 is a deliberate "no automatic
// issue" placeholder and is skipped here).
export function rulesFor(rules, phase, postingCategory) {
  return rules.filter(
    (r) =>
      r.phase === (phase || 'event_day') &&
      r.posting_category === (postingCategory || 'general') &&
      Number(r.qty_per_officer) > 0
  )
}

// Builds a map of line_item_id (SECTION HEADER) -> that section's
// {phase, posting_category}, and a map of posting_slot.id -> the same,
// by walking the slots in sort_order and remembering the most recent
// section header seen (same walking pattern used throughout
// PostingSheet.jsx for per-section lookups).
export function buildSlotSectionMap(slots, lineItemsById) {
  const bySlotId = {}
  let current = { phase: 'event_day', posting_category: 'general' }
  for (const slot of slots) {
    const li = lineItemsById[slot.line_item_id]
    if (!li) continue
    if (li.row_type === 'SECTION HEADER') {
      current = {
        phase: li.phase || 'event_day',
        posting_category: li.posting_category || 'general',
      }
    } else {
      bySlotId[slot.id] = current
    }
  }
  return bySlotId
}

// A slot counts as "assigned" once a name has been entered, whether
// picked from the roster or typed directly — matches how the Posting
// Sheet itself treats a filled row. Equipment sync no longer requires
// this (vacant postings still need equipment packed for them ahead of
// the event), but it's kept for any display logic that wants to tell
// filled and vacant postings apart.
export function isSlotAssigned(slot) {
  return !!(slot.first_name || slot.last_name || slot.officer_id)
}

// Labels a posting for the Equipment Sign-Out detail view: the
// officer's name once assigned, or "Vacant – <posting>" beforehand so
// the office can still see which posting each unassigned issue is for.
export function officerLabel(slot, lineItem) {
  const name = `${slot.first_name || ''} ${slot.last_name || ''}`.trim()
  if (name) return name
  const posting = lineItem?.posting_location || lineItem?.officer_type_name
  return posting ? `Vacant – ${posting}` : 'Vacant posting'
}

// Given every posting on the sheet (with its section phase/category
// attached), filled or still vacant, and the current rules, returns
// the fresh set of rule-generated event_equipment_items rows that
// should exist right now. Vacant postings are included on purpose —
// the office needs to know what to pack before officers are confirmed.
// Does not touch manual rows — the caller re-synchronizes only
// source='rule' rows against this list.
export function generateRuleAssignments(eventId, slotsWithSection, rules) {
  const rows = []
  slotsWithSection.forEach(({ slot, lineItem, phase, posting_category }) => {
    const applicable = rulesFor(rules, phase, posting_category)
    applicable.forEach((rule) => {
      rows.push({
        event_id: eventId,
        equipment_item_id: rule.equipment_item_id,
        posting_slot_id: slot.id,
        officer_label: officerLabel(slot, lineItem),
        qty: Number(rule.qty_per_officer) || 1,
        source: 'rule',
      })
    })
  })
  return rows
}
