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

// Given the joined data for one posting slot (slot row + its line item +
// its matched officer type), returns everything needed to render either
// the Posting Sheet row or the Pay Run row.
export function deriveSlotView(slot, lineItem, officerType) {
  const grade = officerType?.psira_grade || 'N/A'
  const posting = finalPostingText(
    lineItem?.officer_type_name,
    grade,
    lineItem?.posting_location
  )
  const payRate = officerType?.pay_rate ?? 0
  const sellPrice = officerType?.sell_price ?? 0
  const shifts = lineItem?.shifts ?? 1
  return {
    posting,
    grade,
    payRate,
    sellPrice,
    shifts,
    payAmount: Number(payRate) * Number(shifts || 1),
    sellAmount: Number(sellPrice) * Number(shifts || 1),
  }
}
