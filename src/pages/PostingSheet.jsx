import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { deriveSlotView } from '../lib/postingLogic'
import { getIsViewer } from '../lib/roles'
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
          supabase.from('officers').select('*').order('full_name'),
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

  const typesByName = useMemo(() => {
    const m = {}
    types.forEach((t) => (m[t.type_name] = t))
    return m
  }, [types])

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

  function pickOfficer(slot, officerId) {
    if (isViewer) return
    if (!officerId) {
      updateSlot(slot.id, { officer_id: null })
      return
    }
    const o = officers.find((x) => x.id === officerId)
    const nameParts = (o.full_name || '').trim().split(/\s+/)
    const first_name = nameParts.shift() || ''
    const last_name = nameParts.join(' ')
    updateSlot(slot.id, {
      officer_id: o.id,
      first_name,
      last_name,
      id_number: o.id_number,
      psira_number: o.psira_number,
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
  })

  function startEditDetails() {
    setDetailsForm({
      event_name: event.event_name || '',
      venue: event.venue || '',
      event_date: event.event_date || '',
      timing: event.timing || '',
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
            const officerType = typesByName[lineItem.officer_type_name]
            const view = deriveSlotView(slot, lineItem, officerType)
            const unmapped = !officerType
            const isManagerRow = /manager|reaction/i.test(lineItem.officer_type_name || '')

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
                        {o.full_name}
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
                      title="Untick for in-house/MP managers or reaction officers who aren't paid through this Pay Run. Tick for those sourced from a supplier."
                    >
                      <input
                        type="checkbox"
                        checked={slot.include_in_payrun !== false}
                        onChange={(e) =>
                          updateSlot(slot.id, { include_in_payrun: e.target.checked })
                        }
                      />
                      In Pay Run
                    </label>
                  )}
                  {isManagerRow && slot.include_in_payrun === false && (
                    <span className="no-print mp-badge" title="Excluded from Pay Run">
                      MP
                    </span>
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
                        className="no-print time-edit-btn"
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
                        className="no-print time-edit-btn"
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
    </div>
  )
}
