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

// ---------------------------------------------------------------------
// Reading a section's DAY and TIMES
// ---------------------------------------------------------------------
// Sections that came from the uploaded quotation carry item_date and
// start_time/end_time. Sections added by hand ("Add New Day/Shift") only
// carry their heading text, e.g.
//   "SECURITY: Monday, 19 October 2026 - Build-up (06h00 - 18h00)"
// so the day and times are read out of the heading when the dedicated
// fields are blank. A section with no readable date stays on its own
// (treated as a single separate day) — it is never merged with others.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function parseDay(...candidates) {
  for (const text of candidates) {
    if (!text) continue
    const s = String(text)
    const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (iso) {
      const [, y, m, d] = iso
      return {
        key: `${y}-${m}-${d}`,
        label: `${d} ${MONTHS[Number(m) - 1][0].toUpperCase()}${MONTHS[Number(m) - 1].slice(1)} ${y}`,
        sort: Date.UTC(Number(y), Number(m) - 1, Number(d)),
      }
    }
    const m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/)
    if (m) {
      const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
      if (month >= 0) {
        const day = Number(m[1])
        const year = Number(m[3])
        return {
          key: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          label: `${String(day).padStart(2, '0')} ${MONTHS[month][0].toUpperCase()}${MONTHS[month].slice(1)} ${year}`,
          sort: Date.UTC(year, month, day),
        }
      }
    }
  }
  return null
}

function toMinutes(h, m) {
  return Number(h) * 60 + Number(m)
}

// Returns { start, end } in minutes from midnight (end pushed past 24h
// for an overnight shift), or { start: null, end: null } when the times
// can't be read — which is then treated as "all day".
function parseTimes(startText, endText, sectionText) {
  const one = /(\d{1,2})\s*[h:]\s*(\d{2})/
  const a = startText && String(startText).match(one)
  const b = endText && String(endText).match(one)
  let start = a ? toMinutes(a[1], a[2]) : null
  let end = b ? toMinutes(b[1], b[2]) : null
  if (start === null || end === null) {
    const range = String(sectionText || '').match(
      /(\d{1,2})\s*[h:]\s*(\d{2})\s*[-–—to]+\s*(\d{1,2})\s*[h:]\s*(\d{2})/i
    )
    if (range) {
      start = toMinutes(range[1], range[2])
      end = toMinutes(range[3], range[4])
    }
  }
  if (start === null || end === null) return { start: null, end: null }
  if (end <= start) end += 24 * 60
  return { start, end }
}

// Tags every LINE ITEM posting slot with the phase / posting category of
// the SECTION HEADER it falls under, plus that section's id, label, day
// and times. Phase/category come from the tags set on the Posting Sheet.
export function buildSlotSectionMap(slots, lineItemsById) {
  const bySlotId = {}
  let current = {
    phase: 'event_day',
    posting_category: 'general',
    sectionId: null,
    sectionLabel: '',
    day: null,
    start: null,
    end: null,
  }
  for (const slot of slots) {
    const li = lineItemsById[slot.line_item_id]
    if (!li) continue
    if (li.row_type === 'SECTION HEADER') {
      const { start, end } = parseTimes(li.start_time, li.end_time, li.section_text)
      current = {
        phase: li.phase || 'event_day',
        posting_category: li.posting_category || 'general',
        sectionId: li.id,
        sectionLabel: li.section_text || '',
        day: parseDay(li.item_date, li.section_text),
        start,
        end,
      }
    } else {
      bySlotId[slot.id] = current
    }
  }
  return bySlotId
}

// Groups the flat slot list into sections (one entry per Posting Sheet
// section), each with the officer type of every posting in it.
function groupSections(slotsWithSection) {
  const sections = new Map()
  slotsWithSection.forEach(({ slot, lineItem, phase, posting_category, sectionId, sectionLabel, day, start, end }) => {
    const key = sectionId || '__no_section__'
    if (!sections.has(key)) {
      sections.set(key, {
        id: key,
        phase: phase || 'event_day',
        posting_category: posting_category || 'general',
        label: sectionLabel || '',
        day: day || null,
        start: start ?? null,
        end: end ?? null,
        officerTypes: [],
      })
    }
    sections.get(key).officerTypes.push(effectiveOfficerType(slot, lineItem))
  })
  return [...sections.values()]
}

// The busiest moment of a group of sections, counting sections that run
// AT THE SAME TIME together (Hall 1 + Hall 2 + Parking on the same
// shift all need kit at once) but sections that run one AFTER another
// (a day shift then a night shift) as a hand-over, where the same kit is
// reused. A section with no readable times counts as running all day.
function concurrentPeak(entries) {
  const live = entries.filter((e) => e.qty > 0)
  if (live.length === 0) return 0
  const span = (e) => (e.start === null ? [0, Infinity] : [e.start, e.end])
  const checkpoints = new Set([0])
  live.forEach((e) => {
    const [s] = span(e)
    checkpoints.add(s)
  })
  let peak = 0
  checkpoints.forEach((t) => {
    let sum = 0
    live.forEach((e) => {
      const [s, en] = span(e)
      if (t >= s && t < en) sum += e.qty
    })
    if (sum > peak) peak = sum
  })
  return peak
}

// Builds the auto-issued equipment rows for an event — ONE row per
// equipment item.
//
//   • A "day" is a calendar date within a phase (Build-Up / Event Day /
//     Breakdown). Everything running at the same time on that day —
//     every hall, every area — is added together.
//   • If there is more than one day (e.g. two build-up days), the day
//     with the MOST security sets the quantity. It is packed once and
//     reused for the other days — the quantities are never added up
//     across days.
//   • Kit is also reused between phases, so an item's quantity is the
//     largest single-day need across Build-Up, Event Day and Breakdown,
//     not the three added together.
//   • A rule tied to an officer type only counts postings of that type;
//     a blank officer type counts every posting (Pullovers). Cleaning
//     gear tied to the cleaner role therefore only appears when
//     cleaners are actually posted.
//   • Because every count comes from real postings, an item can never
//     exceed (postings in the busiest day × its per-officer quantity).
//
// Each row's officer_label lists every day that was considered (one per
// line) so the Equipment sheet can show exactly how the number was
// reached; the day that set the quantity is marked.
// Items that are only issued for the Event Day itself (staff pullovers).
// Build-up and breakdown numbers must never set their quantity, even if
// a build-up/breakdown rule exists for them. Bibs are not in this list,
// so they still cover build-up + event.
export function isEventDayOnlyItem(item) {
  return /pull\s*-?\s*over/i.test((item && item.name) || '')
}

export function generateRuleAssignments(eventId, slotsWithSection, rules, catalogById = {}) {
  const sections = groupSections(slotsWithSection)

  // Which "day groups" exist: phase + date (undated sections stay alone).
  const groups = new Map()
  sections.forEach((section) => {
    const dayKey = section.day ? section.day.key : `__undated__${section.id}`
    const key = `${section.phase}|${dayKey}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        phase: section.phase,
        dayLabel: section.day ? section.day.label : section.label || 'Undated section',
        sort: section.day ? section.day.sort : Number.MAX_SAFE_INTEGER,
        sections: [],
      })
    }
    groups.get(key).sections.push(section)
  })

  // itemId -> groupKey -> { need, group }
  const needs = new Map()
  rules.forEach((rule) => {
    const perOfficer = Number(rule.qty_per_officer) || 0
    if (!(perOfficer > 0)) return
    const eventOnly = isEventDayOnlyItem(catalogById[rule.equipment_item_id])
    if (eventOnly && (rule.phase || 'event_day') !== 'event_day') return
    groups.forEach((group) => {
      if (group.phase !== (rule.phase || 'event_day')) return
      const entries = group.sections
        .filter((s) => s.posting_category === (rule.posting_category || 'general'))
        .map((s) => ({
          qty: s.officerTypes.filter((t) => ruleMatchesOfficerType(rule, t)).length * perOfficer,
          start: s.start,
          end: s.end,
        }))
      const need = concurrentPeak(entries)
      if (need <= 0) return
      if (!needs.has(rule.equipment_item_id)) needs.set(rule.equipment_item_id, new Map())
      const perGroup = needs.get(rule.equipment_item_id)
      const existing = perGroup.get(group.key) || { need: 0, group }
      existing.need += need
      perGroup.set(group.key, existing)
    })
  })

  const rows = []
  needs.forEach((perGroup, equipmentItemId) => {
    const days = [...perGroup.values()].sort((a, b) => a.group.sort - b.group.sort)
    const peak = days.reduce((best, d) => (d.need > best.need ? d : best), days[0])
    const lines = days.map(
      (d) => `${d === peak ? '✔ ' : ''}${d.group.dayLabel} (${phaseLabel(d.group.phase)}): ${d.need}${d === peak ? ' — used' : ''}`
    )
    rows.push({
      event_id: eventId,
      equipment_item_id: equipmentItemId,
      posting_slot_id: null,
      officer_label: lines.join('\n'),
      qty: peak.need,
      source: 'rule',
    })
  })
  return rows
}

// For the "How the sheet was counted" panel: one entry per Posting Sheet
// section saying how many postings it has, which day/phase/category it
// was read as, and whether any equipment rule picked it up. A section
// that no rule touches is the usual reason kit seems to be "missing".
export function diagnoseSections(slotsWithSection, rules) {
  return groupSections(slotsWithSection).map((section) => {
    const sectionRules = rulesFor(rules, section.phase, section.posting_category)
    let status = 'ok'
    let note = ''
    if (section.officerTypes.length === 0) {
      status = 'empty'
      note = 'No postings in this section.'
    } else if (sectionRules.length === 0) {
      status = 'no_rules'
      note = `No equipment rules exist for ${phaseLabel(section.phase)} / ${postingCategoryLabel(section.posting_category)}. Change this section's Phase/Category on the Posting Sheet, or add a rule on Catalog & Rules.`
    } else if (!sectionRules.some((r) => section.officerTypes.some((t) => ruleMatchesOfficerType(r, t)))) {
      status = 'no_match'
      const types = [...new Set(section.officerTypes.filter(Boolean))].join(', ') || 'none set'
      note = `The rules for ${phaseLabel(section.phase)} / ${postingCategoryLabel(section.posting_category)} are tied to other officer types. This section's postings are: ${types}.`
    }
    return {
      id: section.id,
      label: section.label || '(unnamed section)',
      dayLabel: section.day ? section.day.label : 'No date found',
      phase: section.phase,
      posting_category: section.posting_category,
      postings: section.officerTypes.length,
      status,
      note,
    }
  })
}
