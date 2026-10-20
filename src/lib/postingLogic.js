// Single source of truth for turning parsed quote line items into
// individual posting slots, and for deriving display text/amounts.
// Both the Posting Sheet and Pay Run pages call these same functions
// against the same posting_slots rows, so they can never drift apart
// the way the old two-workbook Excel system did.

export function finalPostingText(officerTypeName, grade, postingLocation) {
  const gradePart = grade && grade !== 'N/A' ? ` ${grade}` : ''
  const loc = postingLocation ? `: ${postingLocation}` : ''
  return `${officerTypeName || 'Unassigned'}${gradePart}${loc}`
}

// Expands parsed Builder-sheet line items into flat posting-slot rows
// ready for insertion. Call this once when an event is created from an
// uploaded quotation.
export function expandLineItemsToSlots(lineItems) {
  const slots = []
  let sortOrder = 0
  lineItems.forEach((item, lineItemIndex) => {
    sortOrder += 1
    if (item.rowType === 'SECTION HEADER') {
      slots.push({
        lineItemIndex,
        rowType: 'SECTION HEADER',
        slotIndex: null,
        sortOrder,
      })
    } else {
      const qty = Math.max(1, Number(item.qty) || 1)
      for (let s = 1; s <= qty; s++) {
        sortOrder += 1
        slots.push({
          lineItemIndex,
          rowType: 'LINE ITEM',
          slotIndex: s,
          sortOrder,
        })
      }
    }
  })
  return slots
}

// Standard shift length that an Officer Type's pay_rate is priced
// against. Worked hours beyond this are paid pro-rata off that same
// rate (pay_rate / STANDARD_SHIFT_HOURS * hoursWorked) rather than
// needing a second rate-card row.
const STANDARD_SHIFT_HOURS = 12

// Hours actually worked on a posting, for the long-shift pro-rata
// calculation. Prefers a manually typed value (slot.manual_hours_worked —
// for when Time In/Time Out weren't captured, or need correcting), and
// otherwise derives it from the slot's own Time In/Time Out stamps.
// Returns null when neither is available, meaning "treat as a standard
// shift" — no proration applied.
export function effectiveHoursWorked(slot) {
  if (
    slot?.manual_hours_worked !== null &&
    slot?.manual_hours_worked !== undefined &&
    slot?.manual_hours_worked !== ''
  ) {
    return Number(slot.manual_hours_worked)
  }
  if (slot?.time_in && slot?.time_out) {
    const ms = new Date(slot.time_out).getTime() - new Date(slot.time_in).getTime()
    if (ms > 0) return Math.round((ms / 3600000) * 100) / 100
  }
  return null
}

// Given the joined data for one posting slot (slot row + its line item +
// its matched officer type), returns everything needed to render either
// the Posting Sheet row or the Pay Run row.
//
// `effectiveTypeName` is optional. Pass it when the slot has an
// `officer_type_override` (e.g. an officer working this posting doesn't
// have Special Events quals, or is being paid off a different rate-card
// role than the section's default) — the caller resolves the actual
// `officerType` row against this name, and this function uses it for the
// displayed posting text so the sheet and Pay Run both show what the
// officer is actually being posted/paid as. Falls back to the line
// item's default `officer_type_name` when not overridden.
//
// Pay is worked out from the Officer Type's default rate (pay_rate —
// the full case: PSIRA + Special Events + a standard 12-hour shift),
// adjusted automatically for what's actually true of THIS posting —
// no separate officer_type row needed per variation:
//   - special_events false on the slot -> officerType.no_special_events_pay_adj
//     is added (normally a negative number — a penalty for not having
//     Special Events quals)
//   - psira_number blank on the slot   -> officerType.no_psira_pay_adj
//     is added (normally a negative number — a penalty for not having
//     a PSIRA registration on file for this posting)
//   - hours worked (from Time In/Time Out, or a manual entry) differ
//     from the standard 12-hour shift -> the base rate is pro-rated:
//     pay_rate / 12 * hoursWorked, before the above adjustments are
//     added on top
// A `manual_pay_rate` typed directly onto the slot overrides all of
// the above — the escape hatch for a one-off, hand-agreed amount.
export function deriveSlotView(slot, lineItem, officerType, effectiveTypeName) {
  const grade = officerType?.psira_grade || 'N/A'
  const typeName = effectiveTypeName || lineItem?.officer_type_name
  const posting = finalPostingText(
    typeName,
    grade,
    lineItem?.posting_location
  )
  // Every posting slot is exactly one shift for one day — the Builder
  // sheet already splits each day into its own SECTION HEADER, so a
  // single slot is never more than one shift. The quote's old
  // "Shifts / Units" column (lineItem.shifts) is deliberately NOT used
  // here any more: multiplying pay/sell amounts by it was double- and
  // triple-billing single-day postings whenever that column held 2 or 3.
  const shifts = 1

  const hasManualPay =
    slot?.manual_pay_rate !== null &&
    slot?.manual_pay_rate !== undefined &&
    slot?.manual_pay_rate !== ''

  const hoursWorked = effectiveHoursWorked(slot)

  let payRate
  if (hasManualPay) {
    payRate = Number(slot.manual_pay_rate)
  } else {
    const basePay = Number(officerType?.pay_rate ?? 0)
    const proratedBase =
      hoursWorked && hoursWorked > 0 ? (basePay / STANDARD_SHIFT_HOURS) * hoursWorked : basePay
    const noSpecialEvents = !slot?.special_events
    const noPsira = !slot?.psira_number
    payRate =
      proratedBase +
      (noSpecialEvents ? Number(officerType?.no_special_events_pay_adj ?? 0) : 0) +
      (noPsira ? Number(officerType?.no_psira_pay_adj ?? 0) : 0)
  }

  const sellPrice = officerType?.sell_price ?? 0
  return {
    posting,
    typeName,
    grade,
    payRate,
    sellPrice,
    shifts,
    hoursWorked,
    isManualPay: hasManualPay,
    payAmount: Number(payRate) * Number(shifts || 1),
    sellAmount: Number(sellPrice) * Number(shifts || 1),
  }
}
