import * as XLSX from 'xlsx'

// Reads the uploaded Quotation .xlsx (Setup + Builder sheets) and returns
// structured event details + line items ready to insert into Supabase.
// This is the single point of truth — no PDF parsing, no retyping.

function findSheet(workbook, wantedName) {
  const exact = workbook.SheetNames.find(
    (n) => n.toLowerCase() === wantedName.toLowerCase()
  )
  if (exact) return workbook.Sheets[exact]
  const partial = workbook.SheetNames.find((n) =>
    n.toLowerCase().includes(wantedName.toLowerCase())
  )
  return partial ? workbook.Sheets[partial] : null
}

function sheetToRows(sheet) {
  // header:1 -> array-of-arrays, keeps blank cells as undefined
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true })
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function fmtTime(val) {
  if (val === null || val === undefined || val === '') return ''
  if (val instanceof Date) {
    // Excel gives us a UTC-based Date for time cells — read UTC hours/
    // minutes, not local, so the displayed time never shifts depending
    // on the viewer's timezone.
    const h = String(val.getUTCHours()).padStart(2, '0')
    const m = String(val.getUTCMinutes()).padStart(2, '0')
    return `${h}h${m}`
  }
  if (typeof val === 'number') {
    // Excel time serial (fraction of a day)
    const totalMinutes = Math.round(val * 24 * 60)
    const h = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')
    const m = String(totalMinutes % 60).padStart(2, '0')
    return `${h}h${m}`
  }
  return String(val).trim()
}

function fmtDateLong(val) {
  if (!val) return ''
  const d = val instanceof Date ? val : new Date(val)
  if (isNaN(d)) return String(val)
  // Excel gives us a UTC-midnight Date for date cells — read UTC date
  // parts, not local, so the calendar day never shifts depending on the
  // viewer's timezone (this was the cause of dates appearing a day early
  // for anyone whose browser/system clock isn't set to SAST).
  const weekday = WEEKDAYS[d.getUTCDay()]
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = MONTHS[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  return `${weekday}, ${day} ${month} ${year}`
}

function fmtDateShort(val) {
  if (!val) return ''
  const d = val instanceof Date ? val : new Date(val)
  if (isNaN(d)) return String(val)
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = MONTHS[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  return `${day} ${month} ${year}`
}

// Build a header-name -> column-index map from the Builder sheet's header row
function headerMap(rows) {
  // header row is the first row containing "Row Type"
  let headerRowIdx = rows.findIndex((r) => r && r.includes('Row Type'))
  if (headerRowIdx === -1) headerRowIdx = 3 // fallback to known layout (row 4, 0-indexed 3)
  const header = rows[headerRowIdx]
  const map = {}
  header.forEach((h, i) => {
    if (h) map[String(h).trim()] = i
  })
  return { map, headerRowIdx }
}

export function parseSetupSheet(workbook) {
  const sheet = findSheet(workbook, 'Setup')
  if (!sheet) return {}
  const rows = sheetToRows(sheet)
  const lookup = {}
  rows.forEach((r) => {
    if (!r) return
    const label = r[0]
    const value = r[1]
    if (label) lookup[String(label).trim()] = value
  })
  const rawEventDate = lookup['Event Date (overview)'] || lookup['Overview Date'] || ''
  return {
    eventName: lookup['Reference Number / Event Name'] || lookup['Event Name'] || '',
    venue: lookup['Venue'] || '',
    eventDate: rawEventDate instanceof Date ? fmtDateShort(rawEventDate) : rawEventDate,
    timing: lookup['Timing (overview)'] || '',
    quotationRef: lookup['Quotation Number'] || '',
  }
}

// Returns { rowType, sortOrder, category, itemDate, shiftName, startTime,
//           endTime, sectionText, qty, officerTypeName, postingLocation, shifts }[]
export function parseBuilderSheet(workbook) {
  const sheet = findSheet(workbook, 'Builder')
  if (!sheet) {
    throw new Error(
      "This file isn't built from the IMPI Builder template — no \"Builder\" sheet found. " +
      'Please recreate this quote using the standard IMPI template (download link below), then upload again.'
    )
  }

  const rows = sheetToRows(sheet)
  const { map, headerRowIdx } = headerMap(rows)

  const col = (name, fallbackNames = []) => {
    if (map[name] !== undefined) return map[name]
    for (const f of fallbackNames) {
      if (map[f] !== undefined) return map[f]
    }
    return -1
  }

  const cRowType = col('Row Type')
  const cCategory = col('Category')
  const cDate = col('Date')
  const cShift = col('Shift')
  const cStart = col('Start')
  const cEnd = col('End')
  const cQty = col('Qty')
  const cOfficerType = col('Officer Type')
  const cNotes = col('Notes / Posting Location', ['Notes'])
  const cShifts = col('Shifts / Units', ['Shifts'])

  if (cRowType === -1) {
    throw new Error(
      "This file isn't built from the IMPI Builder template — the Builder sheet is missing " +
      'expected columns (like "Row Type"). Please recreate this quote using the standard IMPI ' +
      'template (download link below), then upload again.'
    )
  }

  const items = []
  let sortOrder = 0
  let lastCategory = ''
  let lastDate = null
  let lastShift = ''
  let lastStart = ''
  let lastEnd = ''

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r) continue
    const rowType = r[cRowType]
    if (rowType !== 'SECTION HEADER' && rowType !== 'LINE ITEM') continue

    sortOrder += 1

    if (rowType === 'SECTION HEADER') {
      lastCategory = r[cCategory] || ''
      lastDate = r[cDate] || null
      lastShift = r[cShift] || ''
      lastStart = fmtTime(r[cStart])
      lastEnd = fmtTime(r[cEnd])
      const sectionText = `${lastCategory}: ${fmtDateLong(lastDate)} - ${lastShift} (${lastStart} - ${lastEnd})`
      items.push({
        rowType,
        sortOrder,
        category: lastCategory,
        itemDate: fmtDateShort(lastDate),
        shiftName: lastShift,
        startTime: lastStart,
        endTime: lastEnd,
        sectionText,
        qty: 0,
        officerTypeName: null,
        postingLocation: null,
        shifts: null,
      })
    } else {
      const qty = Number(r[cQty]) || 0
      const officerTypeName = (r[cOfficerType] || '').toString().trim()
      const postingLocation = (r[cNotes] || '').toString().trim()
      const shifts = cShifts !== -1 ? Number(r[cShifts]) || 1 : 1
      items.push({
        rowType,
        sortOrder,
        category: lastCategory,
        itemDate: fmtDateShort(lastDate),
        shiftName: lastShift,
        startTime: lastStart,
        endTime: lastEnd,
        sectionText: null,
        qty,
        officerTypeName,
        postingLocation,
        shifts,
      })
    }
  }

  // Only keep personnel postings (Security & Cleaning) — equipment/service
  // lines like Fencing and JOC Compliance have no Officer Type in the
  // Builder sheet, so they're not part of the posting sheet. Also drop
  // clearly third-party/supplier-paid services (Medics, ILS, Ambulance,
  // anything marked "Separate Quote") — IMPI doesn't manage check-in/out
  // or pay for these, so they don't belong on the Posting Sheet either.
  // Add more keywords here if other supplier-only services come up.
  const EXCLUDED_OFFICER_TYPE_PATTERN = /medic|\bils\b|ambulance|separate quote/i
  const withPersonnelOnly = items.filter(
    (it) =>
      it.rowType !== 'LINE ITEM' ||
      (it.officerTypeName && !EXCLUDED_OFFICER_TYPE_PATTERN.test(it.officerTypeName))
  )

  // Drop section headers that end up with no line items under them
  const finalItems = []
  for (let i = 0; i < withPersonnelOnly.length; i++) {
    const item = withPersonnelOnly[i]
    if (item.rowType === 'SECTION HEADER') {
      const next = withPersonnelOnly[i + 1]
      if (!next || next.rowType === 'SECTION HEADER') continue
    }
    finalItems.push(item)
  }

  return finalItems
}

export async function parseQuotationFile(file) {
  const buf = await file.arrayBuffer()
  const workbook = XLSX.read(buf, { type: 'array', cellDates: true })
  const setup = parseSetupSheet(workbook)
  const lineItems = parseBuilderSheet(workbook)
  return { setup, lineItems }
}
