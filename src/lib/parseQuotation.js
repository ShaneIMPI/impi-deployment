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

// Excel's day-0 epoch (in the standard, non-1904 date system) is
// 30 Dec 1899, expressed here as an absolute UTC instant. Using the
// single-argument Date(ms) constructor (never year/month/day args, and
// never SheetJS's own "cellDates" Date-object conversion) is the only
// approach that is guaranteed timezone-independent in JavaScript — pure
// millisecond arithmetic from here on, nothing that depends on the
// runtime's local timezone. This matters especially for very old anchor
// dates: SheetJS's own cellDates conversion, and the native
// `new Date(y, m, d, h, m, s)` constructor, both silently apply
// pre-standardisation "Local Mean Time" for many timezones (e.g. Lagos,
// Nigeria) when constructing a Date near 1899 — which is exactly what
// was shifting dates by a day and times by a handful of minutes for
// anyone outside South Africa.
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30)

function excelSerialToTimeParts(serial) {
  const dayFraction = serial - Math.floor(serial)
  const totalMinutes = Math.round(dayFraction * 24 * 60)
  return { hours: Math.floor(totalMinutes / 60) % 24, minutes: totalMinutes % 60 }
}

function excelSerialToUTCParts(serial) {
  const ms = EXCEL_EPOCH_UTC_MS + Math.round(serial * 86400000)
  const d = new Date(ms)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  }
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
  if (typeof val === 'number') {
    // Excel time serial (fraction of a day) — pure arithmetic, no
    // timezone involved at all.
    const { hours, minutes } = excelSerialToTimeParts(val)
    return `${String(hours).padStart(2, '0')}h${String(minutes).padStart(2, '0')}`
  }
  if (val instanceof Date) {
    // Defensive fallback only — shouldn't be reached now that parsing
    // requests raw serials (cellDates: false) rather than pre-built
    // Date objects.
    const h = String(val.getUTCHours()).padStart(2, '0')
    const m = String(val.getUTCMinutes()).padStart(2, '0')
    return `${h}h${m}`
  }
  return String(val).trim()
}

// Extracts {year, month (0-indexed), day}. Critically, this never trusts
// a Date object handed to us by the xlsx library — testing showed the
// library's own "cellDates" conversion builds those Date objects using
// local-time construction internally, so their stored instant is already
// silently corrupted by the viewer's timezone before we ever see them.
// Instead we read the raw Excel serial number ourselves (parseQuotationFile
// below requests cellDates: false) and convert it with pure arithmetic
// that never depends on the runtime's local timezone at all.
function toDateParts(val) {
  if (typeof val === 'number') {
    const { year, month, day } = excelSerialToUTCParts(val)
    return { year, month, day }
  }
  if (val instanceof Date) {
    // Defensive fallback only — shouldn't be reached now that parsing
    // requests raw serials.
    return { year: val.getUTCFullYear(), month: val.getUTCMonth(), day: val.getUTCDate() }
  }
  const str = String(val).trim()

  // ISO: YYYY-MM-DD (optionally with a time/T suffix)
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) }

  // "5 September 2026" / "05 September 2026"
  m = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
  if (m) {
    const monthIdx = MONTHS.findIndex((mo) => mo.toLowerCase() === m[2].toLowerCase())
    if (monthIdx >= 0) return { year: Number(m[3]), month: monthIdx, day: Number(m[1]) }
  }

  // "September 5, 2026" / "September 5 2026"
  m = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/)
  if (m) {
    const monthIdx = MONTHS.findIndex((mo) => mo.toLowerCase() === m[1].toLowerCase())
    if (monthIdx >= 0) return { year: Number(m[3]), month: monthIdx, day: Number(m[2]) }
  }

  // DD/MM/YYYY
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return { year: Number(m[3]), month: Number(m[2]) - 1, day: Number(m[1]) }

  // Last resort for anything unrecognised — native parsing (may be
  // timezone-sensitive, but only reached for formats we don't handle).
  const d = new Date(str)
  if (!isNaN(d)) return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }
  return null
}

function fmtDateLong(val) {
  if (!val) return ''
  const parts = toDateParts(val)
  if (!parts) return String(val)
  const weekday = WEEKDAYS[new Date(Date.UTC(parts.year, parts.month, parts.day)).getUTCDay()]
  const day = String(parts.day).padStart(2, '0')
  const month = MONTHS[parts.month]
  return `${weekday}, ${day} ${month} ${parts.year}`
}

function fmtDateShort(val) {
  if (!val) return ''
  const parts = toDateParts(val)
  if (!parts) return String(val)
  const day = String(parts.day).padStart(2, '0')
  const month = MONTHS[parts.month]
  return `${day} ${month} ${parts.year}`
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
    eventDate:
      typeof rawEventDate === 'number' ? fmtDateShort(rawEventDate) : rawEventDate,
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
  // cellDates is deliberately OFF — the xlsx library's own Date-object
  // conversion for date/time cells was found to build those Date objects
  // using local-time construction internally, silently corrupting the
  // stored instant depending on the viewer's timezone before our code
  // ever sees it. Reading raw Excel serial numbers instead and doing our
  // own arithmetic (see toDateParts/fmtTime above) avoids that entirely.
  const workbook = XLSX.read(buf, { type: 'array', cellDates: false })
  const setup = parseSetupSheet(workbook)
  const lineItems = parseBuilderSheet(workbook)
  return { setup, lineItems }
}
