import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { deriveSlotView } from '../lib/postingLogic'
import { getIsViewer } from '../lib/roles'
import { REGIONS } from '../lib/regions'
import {
  queueSlotUpdate,
  getQueueCount,
  flushQueue,
  cachePostingSheet,
  getCachedPostingSheet,
} from '../lib/offlineSync'
import Header from '../components/Header'
import SignaturePad from '../components/SignaturePad'

export default function PostingSheet() {
  const { eventId } = useParams()
  const [event, setEvent] = useState(null)
  const [lineItems, setLineItems] = useState([])
  const [slots, setSlots] = useState([])
  const [types, setTypes] = useState([])
  const [officers, setOfficers] = useState([])
  const [loading, setLoading] = useState(true)
  const [signingSlotId, setSigningSlotId] = useState(null)
  const [blankMode, setBlankMode] = useState(false)
  const [isViewer, setIsViewer] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(getQueueCount())
  const [editingTime, setEditingTime] = useState(null) // { slotId, field: 'time_in' | 'time_out' }

  useEffect(() => {
    load()
    getIsViewer().then(setIsViewer)
  }, [eventId])

  useEffect(() => {
    async function sync() {
      const remaining = await flushQueue()
      setPendingCount(remaining)
    }
    function goOnline() {
      setIsOnline(true)
      sync()
    }
    function goOffline() {
      setIsOnline(false)
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    sync() // try syncing anything left over from a previous offline session
    const interval = setInterval(sync, 8000)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      clearInterval(interval)
    }
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [{ data: ev }, { data: li }, { data: sl }, { data: ty }, { data: off }] =
        await Promise.all([
          supabase.from('events').select('*').eq('id', eventId).single(),
          supabase
            .from('quote_line_items')
            .select('*')
            .eq('event_id', eventId)
            .order('sort_order'),
          supabase
            .from('posting_slots')
            .select('*')
            .eq('event_id', eventId)
            .order('sort_order'),
          supabase.from('officer_types').select('*'),
          supabase.from('officers').select('*').order('last_name'),
        ])
      setEvent(ev)
      setLineItems(li || [])
      setSlots(sl || [])
      setTypes(ty || [])
      setOfficers(off || [])
      cachePostingSheet(eventId, {
        event: ev,
        lineItems: li || [],
        slots: sl || [],
        types: ty || [],
        officers: off || [],
      })
    } catch (err) {
      // No signal — fall back to whatever was last cached for this event
      const cached = getCachedPostingSheet(eventId)
      if (cached) {
        setEvent(cached.event)
        setLineItems(cached.lineItems)
        setSlots(cached.slots)
        setTypes(cached.types)
        setOfficers(cached.officers)
      }
      setIsOnline(false)
    }
    setLoading(false)
  }

  const lineItemsById = useMemo(() => {
    const m = {}
    lineItems.forEach((li) => (m[li.id] = li))
    return m
  }, [lineItems])

  const typesByNameAndRegion = useMemo(() => {
    const m = {}
    types.forEach((t) => {
      if (!m[t.type_name]) m[t.type_name] = {}
      m[t.type_name][t.region || ''] = t
    })
    return m
  }, [types])

  function resolveOfficerType(typeName) {
    const variants = typesByNameAndRegion[typeName]
    if (!variants) return undefined
    const eventRegion = event?.region || ''
    return variants[eventRegion] || variants[''] || Object.values(variants)[0]
  }

  // For each SECTION HEADER's line item id, the sort_order of the last
  // slot currently in that section — new postings get inserted right
  // after this point, and everything after it shifts down to make room.
  const sectionEndSortOrder = useMemo(() => {
    const map = {}
    let currentHeaderLineItemId = null
    let currentMax = null
    for (const slot of slots) {
      const li = lineItemsById[slot.line_item_id]
      if (!li) continue
      if (li.row_type === 'SECTION HEADER') {
        if (currentHeaderLineItemId !== null) map[currentHeaderLineItemId] = currentMax
        currentHeaderLineItemId = li.id
        currentMax = slot.sort_order
      } else {
        currentMax = slot.sort_order
      }
    }
    if (currentHeaderLineItemId !== null) map[currentHeaderLineItemId] = currentMax
    return map
  }, [slots, lineItemsById])

  const { totalPostings, signedCount } = useMemo(() => {
    const postingSlots = slots.filter((s) => {
      const li = lineItemsById[s.line_item_id]
      return li && li.row_type === 'LINE ITEM'
    })
    return {
      totalPostings: postingSlots.length,
      signedCount: postingSlots.filter((s) => s.signature_data).length,
    }
  }, [slots, lineItemsById])

  async function updateSlot(id, patch) {
    if (isViewer) return
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))

    if (!navigator.onLine) {
      queueSlotUpdate(id, patch)
      setPendingCount(getQueueCount())
      return
    }
    try {
      const { error } = await supabase.from('posting_slots').update(patch).eq('id', id)
      if (error) throw error
    } catch {
      // Network call failed even though navigator.onLine said we're
      // connected (e.g. wifi with no real internet) — queue it anyway
      // rather than silently losing the change.
      queueSlotUpdate(id, patch)
      setPendingCount(getQueueCount())
      setIsOnline(false)
    }
  }

  async function removeSlot(id) {
    if (isViewer) return
    if (!confirm('Remove this posting from the sheet? This cannot be undone.')) return
    setSlots((prev) => prev.filter((s) => s.id !== id))
    await supabase.from('posting_slots').delete().eq('id', id)
  }

  const [addingToHeaderId, setAddingToHeaderId] = useState(null)
  const [addForm, setAddForm] = useState({ officer_type_name: '', posting_location: '', qty: 1 })
  const [addSaving, setAddSaving] = useState(false)

  const [showAddSection, setShowAddSection] = useState(false)
  const [sectionForm, setSectionForm] = useState({ section_text: '', insertAfter: 'END' })
  const [sectionSaving, setSectionSaving] = useState(false)

  // List of existing sections, in order, for the "insert after" dropdown.
  const sectionOptions = useMemo(() => {
    const opts = []
    for (const slot of slots) {
      const li = lineItemsById[slot.line_item_id]
      if (li && li.row_type === 'SECTION HEADER') {
        opts.push({ id: li.id, label: li.section_text })
      }
    }
    return opts
  }, [slots, lineItemsById])

  async function addSection() {
    if (isViewer) return
    const sectionText = sectionForm.section_text.trim()
    if (!sectionText) return
    setSectionSaving(true)

    const insertAfter =
      sectionForm.insertAfter === 'END'
        ? slots.reduce((max, s) => Math.max(max, s.sort_order), 0)
        : sectionForm.insertAfter === 'BEGINNING'
        ? slots.reduce((min, s) => Math.min(min, s.sort_order), 0) - 1
        : sectionEndSortOrder[sectionForm.insertAfter]

    // Make room for the one new header row.
    const toShift = slots.filter((s) => s.sort_order > insertAfter)
    const concurrency = 20
    for (let i = 0; i < toShift.length; i += concurrency) {
      const chunk = toShift.slice(i, i + concurrency)
      await Promise.all(
        chunk.map((s) =>
          supabase.from('posting_slots').update({ sort_order: s.sort_order + 1 }).eq('id', s.id)
        )
      )
    }

    const { data: newLineItem, error: liError } = await supabase
      .from('quote_line_items')
      .insert({
        event_id: eventId,
        row_type: 'SECTION HEADER',
        sort_order: insertAfter,
        section_text: sectionText,
        page_break_before: true,
      })
      .select()
      .single()
    if (liError) {
      alert('Could not add day/shift: ' + liError.message)
      setSectionSaving(false)
      return
    }

    const { error: slotError } = await supabase.from('posting_slots').insert({
      event_id: eventId,
      line_item_id: newLineItem.id,
      slot_index: null,
      sort_order: insertAfter + 1,
      status: 'vacant',
    })
    if (slotError) {
      alert('Could not add day/shift: ' + slotError.message)
      setSectionSaving(false)
      return
    }

    setShowAddSection(false)
    setSectionForm({ section_text: '', insertAfter: 'END' })
    setSectionSaving(false)
    load()
  }

  async function toggleCompleted() {
    if (isViewer) return
    const next = event.status === 'completed' ? 'draft' : 'completed'
    const { error } = await supabase.from('events').update({ status: next }).eq('id', eventId)
    if (!error) setEvent((prev) => ({ ...prev, status: next }))
  }

  async function addPosting() {
    if (isViewer || !addingToHeaderId) return
    const officerTypeName = addForm.officer_type_name.trim()
    if (!officerTypeName) return
    const qty = Math.max(1, Number(addForm.qty) || 1)
    const insertAfter = sectionEndSortOrder[addingToHeaderId]
    setAddSaving(true)

    // Make room: everything after the insertion point shifts down by qty.
    const toShift = slots.filter((s) => s.sort_order > insertAfter)
    const concurrency = 20
    for (let i = 0; i < toShift.length; i += concurrency) {
      const chunk = toShift.slice(i, i + concurrency)
      await Promise.all(
        chunk.map((s) =>
          supabase.from('posting_slots').update({ sort_order: s.sort_order + qty }).eq('id', s.id)
        )
      )
    }

    // Security Managers and Safety Officers default to IMPI (excluded
    // from Pay Run), same rule as a fresh quotation import.
    const IMPI_DEFAULT_PATTERN = /security manager|safety officer/i
    const isImpiDefault = IMPI_DEFAULT_PATTERN.test(officerTypeName)

    const { data: newLineItem, error: liError } = await supabase
      .from('quote_line_items')
      .insert({
        event_id: eventId,
        row_type: 'LINE ITEM',
        sort_order: insertAfter,
        qty,
        officer_type_name: officerTypeName,
        posting_location: addForm.posting_location.trim(),
        shifts: 1,
      })
      .select()
      .single()
    if (liError) {
      alert('Could not add posting: ' + liError.message)
      setAddSaving(false)
      return
    }

    const newSlotRows = []
    for (let s = 1; s <= qty; s++) {
      newSlotRows.push({
        event_id: eventId,
        line_item_id: newLineItem.id,
        slot_index: s,
        sort_order: insertAfter + s,
        status: 'vacant',
        include_in_payrun: isImpiDefault ? false : true,
      })
    }
    const { error: slotError } = await supabase.from('posting_slots').insert(newSlotRows)
    if (slotError) {
      alert('Could not add posting slots: ' + slotError.message)
      setAddSaving(false)
      return
    }

    setAddingToHeaderId(null)
    setAddForm({ officer_type_name: '', posting_location: '', qty: 1 })
    setAddSaving(false)
    load() // reload so the shifted + new rows come back in the right order
  }

  function pickOfficer(slot, officerId) {
    if (isViewer) return
    if (!officerId) {
      updateSlot(slot.id, { officer_id: null })
      return
    }
    const o = officers.find((x) => x.id === officerId)
    updateSlot(slot.id, {
      officer_id: o.id,
      first_name: o.first_name,
      last_name: o.last_name,
      id_number: o.id_number,
      psira_number: o.psira_number,
      assigned_grade: o.psira_grade || '',
      special_events: !!o.special_events,
    })
  }

  async function checkIn(slot) {
    if (isViewer) return
    updateSlot(slot.id, { status: 'checked_in', time_in: new Date().toISOString() })
  }
  async function checkOut(slot) {
    if (isViewer) return
    updateSlot(slot.id, { status: 'checked_out', time_out: new Date().toISOString() })
  }

  function toDatetimeLocalValue(iso) {
    const d = new Date(iso)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`
  }

  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsForm, setDetailsForm] = useState({
    event_name: '',
    venue: '',
    event_date: '',
    timing: '',
    region: '',
  })

  function startEditDetails() {
    setDetailsForm({
      event_name: event.event_name || '',
      venue: event.venue || '',
      event_date: event.event_date || '',
      timing: event.timing || '',
      region: event.region || '',
    })
    setEditingDetails(true)
  }

  async function saveDetails() {
    const { error } = await supabase.from('events').update(detailsForm).eq('id', eventId)
    if (!error) {
      setEvent((prev) => ({ ...prev, ...detailsForm }))
      setEditingDetails(false)
    }
  }

  async function toggleSectionBreak(lineItemId, currentValue) {
    if (isViewer) return
    const next = !currentValue
    setLineItems((prev) =>
      prev.map((li) => (li.id === lineItemId ? { ...li, page_break_before: next } : li))
    )
    await supabase.from('quote_line_items').update({ page_break_before: next }).eq('id', lineItemId)
  }

  if (loading) return <div className="page">Loading…</div>
  if (!event) return <div className="page">Event not found.</div>

  let postingCounter = 0
  let sectionIndex = 0

  return (
    <div className="page posting-sheet">
      <Header title="Posting Sheet — Security" />

      <div className="event-meta no-print">
        <Link to="/">← Back to Events</Link>
        <button onClick={() => window.print()}>Print</button>
        <button
          onClick={() => {
            navigator.clipboard.writeText(window.location.href)
            alert(
              "Link copied. Note: whoever opens this needs to sign in with an IMPI email — there's no public link yet. " +
              'For suppliers without an IMPI login, use "Blank for Supplier" below and print/save as PDF instead.'
            )
          }}
        >
          Copy Share Link
        </button>
        <label className="blank-toggle">
          <input
            type="checkbox"
            checked={blankMode}
            onChange={(e) => setBlankMode(e.target.checked)}
          />
          Blank for Supplier (hide names before printing/PDF)
        </label>
        {!isViewer && !editingDetails && (
          <button onClick={startEditDetails}>Edit Event Details</button>
        )}
        {!isViewer && (
          <button onClick={() => setShowAddSection(true)}>+ Add New Day / Shift</button>
        )}
        {!isViewer && (
          <button className={event.status === 'completed' ? '' : 'btn-primary'} onClick={toggleCompleted}>
            {event.status === 'completed' ? 'Reopen Event' : 'Mark as Completed'}
          </button>
        )}
        {event.status === 'completed' && (
          <span className="completed-badge">✓ Completed</span>
        )}
        {isViewer && <span className="viewer-badge">View-only access</span>}
        {!isOnline && (
          <span className="offline-badge">
            ⚠ Offline — changes are saving locally and will sync automatically
          </span>
        )}
        {isOnline && pendingCount > 0 && (
          <span className="syncing-badge">Syncing {pendingCount} change{pendingCount === 1 ? '' : 's'}…</span>
        )}
      </div>

      {editingDetails ? (
        <div className="event-meta no-print inline-form">
          <input
            placeholder="Event Name"
            value={detailsForm.event_name}
            onChange={(e) => setDetailsForm({ ...detailsForm, event_name: e.target.value })}
          />
          <input
            placeholder="Overview Date"
            value={detailsForm.event_date}
            onChange={(e) => setDetailsForm({ ...detailsForm, event_date: e.target.value })}
          />
          <input
            placeholder="Venue"
            value={detailsForm.venue}
            onChange={(e) => setDetailsForm({ ...detailsForm, venue: e.target.value })}
          />
          <input
            placeholder="Timing"
            value={detailsForm.timing}
            onChange={(e) => setDetailsForm({ ...detailsForm, timing: e.target.value })}
          />
          <select
            value={detailsForm.region}
            onChange={(e) => setDetailsForm({ ...detailsForm, region: e.target.value })}
          >
            <option value="">— No Region Set —</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={saveDetails}>
            Save
          </button>
          <button onClick={() => setEditingDetails(false)}>Cancel</button>
        </div>
      ) : (
        <div className="event-meta">
          <div>
            <strong>EVENT NAME:</strong> {event.event_name}
          </div>
          <div>
            <strong>OVERVIEW DATE:</strong> {event.event_date}
          </div>
          <div>
            <strong>VENUE:</strong> {event.venue}
          </div>
          <div>
            <strong>TIMING:</strong> {event.timing}
          </div>
          {event.region && (
            <div>
              <strong>REGION:</strong> {event.region}
            </div>
          )}
          <div>
            <strong>SIGNED:</strong> {signedCount} of {totalPostings}
          </div>
        </div>
      )}

      <table className="posting-table">
        <thead>
          <tr>
            <th>No.</th>
            <th>Name &amp; Surname</th>
            <th>ID Number</th>
            <th>PSIRA No.</th>
            <th>BIB No.</th>
            <th>Posting</th>
            <th>PSIRA Grade</th>
            <th>Special Events</th>
            <th>Time In</th>
            <th>Time Out</th>
            <th>Sign</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => {
            const lineItem = lineItemsById[slot.line_item_id]
            if (!lineItem) return null

            if (lineItem.row_type === 'SECTION HEADER') {
              postingCounter = 0
              const isFirstSection = sectionIndex === 0
              const wantsBreak = lineItem.page_break_before !== false
              sectionIndex += 1
              return (
                <tr
                  key={slot.id}
                  className={
                    !isFirstSection && wantsBreak ? 'section-row force-page-break' : 'section-row'
                  }
                >
                  <td colSpan={11}>
                    <div className="section-header-inner">
                      <span>{lineItem.section_text}</span>
                      {!isViewer && (
                        <button
                          type="button"
                          className="no-print add-posting-btn"
                          onClick={() => setAddingToHeaderId(lineItem.id)}
                        >
                          + Add Posting
                        </button>
                      )}
                      {!isViewer && !isFirstSection && (
                        <label className="no-print section-break-toggle">
                          <input
                            type="checkbox"
                            checked={wantsBreak}
                            onChange={() =>
                              toggleSectionBreak(lineItem.id, lineItem.page_break_before !== false)
                            }
                          />
                          Start new page here
                        </label>
                      )}
                    </div>
                  </td>
                </tr>
              )
            }

            postingCounter += 1
            const officerType = resolveOfficerType(lineItem.officer_type_name)
            const view = deriveSlotView(slot, lineItem, officerType)
            const unmapped = !officerType
            const isManagerRow = /manager|reaction|safety/i.test(lineItem.officer_type_name || '')

            return (
              <tr key={slot.id}>
                <td>{postingCounter}</td>
                <td className="no-print-input">
                  <select
                    value={slot.officer_id || ''}
                    onChange={(e) => pickOfficer(slot, e.target.value)}
                    className="no-print"
                    disabled={isViewer}
                  >
                    <option value="">— type manually below —</option>
                    {officers.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.first_name} {o.last_name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="print-input"
                    value={
                      blankMode
                        ? ''
                        : !slot.first_name && !slot.last_name
                        ? ''
                        : `${slot.first_name || ''} ${slot.last_name || ''}`
                    }
                    disabled={blankMode || isViewer}
                    onChange={(e) => {
                      const [first_name, ...rest] = e.target.value.split(' ')
                      updateSlot(slot.id, {
                        first_name,
                        last_name: rest.join(' '),
                        officer_id: null,
                      })
                    }}
                    placeholder="Name & Surname"
                  />
                </td>
                <td>
                  <input
                    className="print-input"
                    value={blankMode ? '' : slot.id_number || ''}
                    disabled={blankMode || isViewer}
                    onChange={(e) => updateSlot(slot.id, { id_number: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="print-input"
                    value={blankMode ? '' : slot.psira_number || ''}
                    disabled={blankMode || isViewer}
                    onChange={(e) => updateSlot(slot.id, { psira_number: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="print-input"
                    value={blankMode ? '' : slot.bib_serial || ''}
                    disabled={blankMode || isViewer}
                    onChange={(e) => updateSlot(slot.id, { bib_serial: e.target.value })}
                  />
                </td>
                <td className={unmapped ? 'warning-cell' : ''}>
                  {isManagerRow && slot.include_in_payrun === false ? 'IMPI - ' : ''}
                  {view.posting}
                  {unmapped && (
                    <span title="This Officer Type isn't in the rate card yet — set it up on the Officer Roster page.">
                      {' '}
                      ⚠
                    </span>
                  )}
                  {isManagerRow && !isViewer && (
                    <label
                      className="no-print manager-payrun-toggle"
                      title="Tick IMPI for your own staff — shown with an IMPI prefix and excluded from this Pay Run. Untick when this posting is filled by a supplier — they'll be included in the Pay Run instead."
                    >
                      <input
                        type="checkbox"
                        checked={slot.include_in_payrun === false}
                        onChange={(e) =>
                          updateSlot(slot.id, { include_in_payrun: !e.target.checked })
                        }
                      />
                      IMPI
                    </label>
                  )}
                  {isManagerRow && slot.include_in_payrun === false && (
                    <span className="no-print mp-badge" title="Excluded from Pay Run">
                      IMPI
                    </span>
                  )}
                  {!isViewer && (
                    <button
                      type="button"
                      className="no-print remove-posting-btn"
                      title="Remove this posting from the sheet"
                      onClick={() => removeSlot(slot.id)}
                    >
                      ✕
                    </button>
                  )}
                </td>
                <td className="no-print-input">
                  <select
                    value={slot.assigned_grade || ''}
                    disabled={isViewer}
                    onChange={(e) => updateSlot(slot.id, { assigned_grade: e.target.value })}
                    className="no-print"
                    title={`Post requires: ${view.grade}`}
                  >
                    <option value="">— Select (Req: {view.grade}) —</option>
                    <option value="N/A">N/A</option>
                    <option value="Gr A">Gr A</option>
                    <option value="Gr B">Gr B</option>
                    <option value="Gr C">Gr C</option>
                    <option value="Gr D">Gr D</option>
                    <option value="Gr E">Gr E</option>
                  </select>
                  <input
                    className="print-input"
                    value={blankMode ? '' : slot.assigned_grade || ''}
                    disabled
                    readOnly
                  />
                </td>
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={!!slot.special_events}
                    disabled={isViewer}
                    onChange={(e) =>
                      updateSlot(slot.id, { special_events: e.target.checked })
                    }
                  />
                </td>
                <td className="no-print-input">
                  {editingTime?.slotId === slot.id && editingTime.field === 'time_in' ? (
                    <input
                      type="datetime-local"
                      className="time-edit-input"
                      autoFocus
                      defaultValue={
                        slot.time_in ? toDatetimeLocalValue(slot.time_in) : toDatetimeLocalValue(new Date())
                      }
                      onBlur={(e) => {
                        if (e.target.value) {
                          updateSlot(slot.id, { time_in: new Date(e.target.value).toISOString() })
                        }
                        setEditingTime(null)
                      }}
                    />
                  ) : slot.time_in ? (
                    isViewer ? (
                      new Date(slot.time_in).toLocaleTimeString('en-ZA', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    ) : (
                      <button
                        className="time-edit-btn"
                        title="Click to correct this time"
                        onClick={() => setEditingTime({ slotId: slot.id, field: 'time_in' })}
                      >
                        {new Date(slot.time_in).toLocaleTimeString('en-ZA', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </button>
                    )
                  ) : isViewer ? (
                    '—'
                  ) : (
                    <button className="no-print" onClick={() => checkIn(slot)}>
                      Check In
                    </button>
                  )}
                </td>
                <td className="no-print-input">
                  {editingTime?.slotId === slot.id && editingTime.field === 'time_out' ? (
                    <input
                      type="datetime-local"
                      className="time-edit-input"
                      autoFocus
                      defaultValue={
                        slot.time_out ? toDatetimeLocalValue(slot.time_out) : toDatetimeLocalValue(new Date())
                      }
                      onBlur={(e) => {
                        if (e.target.value) {
                          updateSlot(slot.id, { time_out: new Date(e.target.value).toISOString() })
                        }
                        setEditingTime(null)
                      }}
                    />
                  ) : slot.time_out ? (
                    isViewer ? (
                      new Date(slot.time_out).toLocaleTimeString('en-ZA', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    ) : (
                      <button
                        className="time-edit-btn"
                        title="Click to correct this time"
                        onClick={() => setEditingTime({ slotId: slot.id, field: 'time_out' })}
                      >
                        {new Date(slot.time_out).toLocaleTimeString('en-ZA', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </button>
                    )
                  ) : isViewer ? (
                    '—'
                  ) : (
                    <button className="no-print" onClick={() => checkOut(slot)}>
                      Check Out
                    </button>
                  )}
                </td>
                <td className="sign-cell no-print-input">
                  {slot.signature_data ? (
                    <img
                      src={slot.signature_data}
                      alt="Signed"
                      className="signature-thumb"
                      onClick={() => !isViewer && setSigningSlotId(slot.id)}
                    />
                  ) : isViewer ? (
                    '—'
                  ) : (
                    <button className="no-print" onClick={() => setSigningSlotId(slot.id)}>
                      Sign
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {signingSlotId && (
        <SignaturePad
          initialValue={slots.find((s) => s.id === signingSlotId)?.signature_data || null}
          onSave={(dataUrl) => {
            updateSlot(signingSlotId, { signature_data: dataUrl })
            setSigningSlotId(null)
          }}
          onClose={() => setSigningSlotId(null)}
        />
      )}

      {addingToHeaderId && (
        <div className="signature-overlay">
          <div className="signature-modal">
            <h3>Add Posting</h3>
            <p>
              This is added to the section you clicked, right after its current last
              row. Existing rows below it (including anyone already signed in) shift
              down but keep all their data — nothing is touched.
            </p>
            <div className="inline-form" style={{ flexDirection: 'column' }}>
              <input
                list="officer-type-options"
                placeholder="Officer Type (e.g. Event Security Officer Gr C)"
                value={addForm.officer_type_name}
                onChange={(e) => setAddForm({ ...addForm, officer_type_name: e.target.value })}
              />
              <datalist id="officer-type-options">
                {types.map((t) => (
                  <option key={t.id} value={t.type_name} />
                ))}
              </datalist>
              <input
                placeholder="Posting / Location (e.g. Gate 2)"
                value={addForm.posting_location}
                onChange={(e) => setAddForm({ ...addForm, posting_location: e.target.value })}
              />
              <input
                type="number"
                min="1"
                placeholder="Quantity"
                value={addForm.qty}
                onChange={(e) => setAddForm({ ...addForm, qty: e.target.value })}
              />
            </div>
            <div className="signature-actions">
              <button
                className="btn-primary"
                onClick={addPosting}
                disabled={!addForm.officer_type_name.trim() || addSaving}
              >
                {addSaving
                  ? 'Adding…'
                  : `Add ${addForm.qty || 1} Posting${Number(addForm.qty) > 1 ? 's' : ''}`}
              </button>
              <button
                onClick={() => {
                  setAddingToHeaderId(null)
                  setAddForm({ officer_type_name: '', posting_location: '', qty: 1 })
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddSection && (
        <div className="signature-overlay">
          <div className="signature-modal">
            <h3>Add New Day / Shift</h3>
            <p>
              Creates a new section heading anywhere on the sheet — beginning, middle,
              or end (e.g. a shift the client added before your original postings).
              Add postings to it afterward using its own "+ Add Posting" button.
            </p>
            <div className="inline-form" style={{ flexDirection: 'column' }}>
              <input
                placeholder='Section heading (e.g. "BUILD-UP: Thursday, 14 August 2026 - Night Shift (19h00 - 07h00)")'
                value={sectionForm.section_text}
                onChange={(e) => setSectionForm({ ...sectionForm, section_text: e.target.value })}
              />
              <label className="section-break-toggle" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                Where should this go?
                <select
                  value={sectionForm.insertAfter}
                  onChange={(e) => setSectionForm({ ...sectionForm, insertAfter: e.target.value })}
                >
                  <option value="BEGINNING">Beginning of the sheet (before everything)</option>
                  {sectionOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      After: {opt.label}
                    </option>
                  ))}
                  <option value="END">The very end of the sheet</option>
                </select>
              </label>
            </div>
            <div className="signature-actions">
              <button
                className="btn-primary"
                onClick={addSection}
                disabled={!sectionForm.section_text.trim() || sectionSaving}
              >
                {sectionSaving ? 'Adding…' : 'Add Day / Shift'}
              </button>
              <button
                onClick={() => {
                  setShowAddSection(false)
                  setSectionForm({ section_text: '', insertAfter: 'END' })
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
