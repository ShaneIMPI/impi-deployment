import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { deriveSlotView } from '../lib/postingLogic'
import { getIsViewer } from '../lib/roles'
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

  useEffect(() => {
    load()
    getIsViewer().then(setIsViewer)
  }, [eventId])

  async function load() {
    setLoading(true)
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
    await supabase.from('posting_slots').update(patch).eq('id', id)
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
      bib_serial: o.bib_serial,
      assigned_grade: o.psira_grade || '',
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

  if (loading) return <div className="page">Loading…</div>
  if (!event) return <div className="page">Event not found.</div>

  let postingCounter = 0

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
        {isViewer && <span className="viewer-badge">View-only access</span>}
      </div>

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
              return (
                <tr key={slot.id} className="section-row">
                  <td colSpan={11}>{lineItem.section_text}</td>
                </tr>
              )
            }

            postingCounter += 1
            const officerType = typesByName[lineItem.officer_type_name]
            const view = deriveSlotView(slot, lineItem, officerType)
            const unmapped = !officerType

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
                        : slot.first_name || slot.last_name
                        ? `${slot.first_name || ''} ${slot.last_name || ''}`.trim()
                        : ''
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
                </td>
                <td>
                  <select
                    className="print-input"
                    value={blankMode ? '' : slot.assigned_grade || ''}
                    disabled={blankMode || isViewer}
                    onChange={(e) => updateSlot(slot.id, { assigned_grade: e.target.value })}
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
                  {slot.time_in ? (
                    new Date(slot.time_in).toLocaleTimeString('en-ZA', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  ) : isViewer ? (
                    '—'
                  ) : (
                    <button className="no-print" onClick={() => checkIn(slot)}>
                      Check In
                    </button>
                  )}
                </td>
                <td className="no-print-input">
                  {slot.time_out ? (
                    new Date(slot.time_out).toLocaleTimeString('en-ZA', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
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
