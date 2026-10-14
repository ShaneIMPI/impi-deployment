// Single source of truth for the Equipment Sign-Out feature — mirrors
// the convention in postingLogic.js so the Equipment page and any
// future consumer never drift apart.

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

// A posting's officer type can be overridden per individual slot
// (PostingSheet.jsx), falling back to the section/line item's default
// — this is the one place that logic should live so rule-matching
// never drifts out of sync with what the Posting Sheet actually shows.
export function effectiveOfficerType(slot, lineItem) {
  return (slot?.officer_type_override || lineItem?.officer_type_name || '').trim()
}

export function rulesFor(rules, phase, postingCategory) {
  return rules.filter(
    (r) =>
      r.phase === (phase || 'event_day') &&
      r.posting_category === (postingCategory || 'general') &&
      Number(r.qty_per_officer) > 0
  )
}

// A blank officer_type_name on a rule means "every officer type" —
// this is how Pullovers (worn by all roles) and any other
// universal item keep working. A rule with an officer type set only
// matches postings of that exact type, which is also what makes
// cleaning equipment automatic: tie a rule's officer type to the
// cleaner role and it simply never matches (so never issues) on an
// event with no cleaner posted.
export function ruleMatchesOfficerType(rule, officerTypeName) {
  const ruleType = (rule.officer_type_name || '').trim()
  if (!ruleType) return true
  return ruleType === (officerTypeName || '').trim()
}

export function officerTypeLabelForRule(rule) {
  return (rule.officer_type_name || '').trim() || 'All officer types'
}

// Tags every LINE ITEM posting slot with the phase/posting_category of
// the SECTION HEADER it falls under, plus that section's own id/label —
// the section is the only grouping boundary the sheet actually has
// (there's no reliable per-day date field), so it doubles as "one
// deployment instance" for the pack-once-per-phase logic below.
export function buildSlotSectionMap(slots, lineItemsById) {
  const bySlotId = {}
  let current = { phase: 'event_day', posting_category: 'general', sectionId: null, sectionLabel: '' }
  for (const slot of slots) {
    const li = lineItemsById[slot.line_item_id]
    if (!li) continue
    if (li.row_type === 'SECTION HEADER') {
      current = {
        phase: li.phase || 'event_day',
        posting_category: li.posting_category || 'general',
        sectionId: li.id,
        sectionLabel: li.section_text || '',
      }
    } else {
      bySlotId[slot.id] = current
    }
  }
  return bySlotId
}

// Builds the auto-issued equipment rows for an event. Each `rule` is
// matched against every SECTION on the Posting Sheet that shares its
// phase + posting category; the section is treated as one deployment
// instance (one day, one build-up slot, one breakdown slot, etc.).
// Equipment only ever gets packed for the SINGLE busiest instance of
// a rule's phase — never summed across every section — because the
// same kit is reused day to day, and Build-Up/Breakdown should size
// off their highest single deployment, not every shift added together.
// A rule tied to one officer type only counts postings of that type;
// a blank officer type counts every posting in the section, which is
// what makes a universal item (Pullovers) and a gated one (cleaning
// gear, once tied to the cleaner role) both fall out of the same rule.
export function generateRuleAssignments(eventId, slotsWithSection, rules) {
  // sectionId (or a fallback bucket) -> { phase, posting_category, sectionLabel, slots }
  const sections = new Map()
  slotsWithSection.forEach(({ slot, lineItem, phase, posting_category, sectionId, sectionLabel }) => {
    const key = sectionId || '__no_section__'
    if (!sections.has(key)) {
      sections.set(key, {
        phase: phase || 'event_day',
        posting_category: posting_category || 'general',
        sectionLabel: sectionLabel || '',
        slots: [],
      })
    }
    sections.get(key).slots.push({ officerType: effectiveOfficerType(slot, lineItem) })
  })

  const rows = []
  rules.forEach((rule) => {
    if (!(Number(rule.qty_per_officer) > 0)) return
    let peakQty = 0
    let peakCount = 0
    let peakLabel = ''
    sections.forEach((section) => {
      if (section.phase !== (rule.phase || 'event_day')) return
      if (section.posting_category !== (rule.posting_category || 'general')) return
      const count = section.slots.filter((s) => ruleMatchesOfficerType(rule, s.officerType)).length
      const qty = count * (Number(rule.qty_per_officer) || 1)
      if (qty > peakQty) {
        peakQty = qty
        peakCount = count
        peakLabel = section.sectionLabel || phaseLabel(section.phase)
      }
    })
    if (peakQty > 0) {
      rows.push({
        event_id: eventId,
        equipment_item_id: rule.equipment_item_id,
        posting_slot_id: null,
        officer_label: `${officerTypeLabelForRule(rule)} — ${peakCount} needed (peak: ${peakLabel})`,
        qty: peakQty,
        source: 'rule',
      })
    }
  })
  return rows
}
