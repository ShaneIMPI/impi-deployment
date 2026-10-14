import { Fragment, useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { getIsViewer } from '../lib/roles'
import { buildSlotSectionMap, generateRuleAssignments } from '../lib/equipmentLogic'
import Header from '../components/Header'

export default function EquipmentSignOut() {
  const { eventId } = useParams()
  const [event, setEvent] = useState(null)
  const [lineItems, setLineItems] = useState([])
  const [slots, setSlots] = useState([])
  const [catalog, setCatalog] = useState([])
  const [rules, setRules] = useState([])
  const [items, setItems] = useState([])
  const [verification, setVerification] = useState([])
  const [signoff, setSignoff] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isViewer, setIsViewer] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [manualForm, setManualForm] = useState({ equipment_item_id: '', qty: 1 })

  useEffect(() => {
    load()
    getIsViewer().then(setIsViewer)
  }, [eventId])

  async function load() {
    setLoading(true)
    const [
      { data: ev },
      { data: li },
      { data: sl },
      { data: cat },
      { data: rul },
      { data: it },
      { data: ver },
      { data: so },
    ] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase.from('quote_line_items').select('*').eq('event_id', eventId).order('sort_order'),
      supabase.from('posting_slots').select('*').eq('event_id', eventId).order('sort_order'),
      supabase.from('equipment_catalog').select('*').order('sort_order'),
      supabase.from('equipment_rules').select('*'),
      supabase.from('event_equipment_items').select('*').eq('event_id', eventId),
      supabase.from('event_equipment_verification').select('*').eq('event_id', eventId),
      supabase.from('event_equipment_signoff').select('*').eq('event_id', eventId).maybeSingle(),
    ])
    setEvent(ev)
    setLineItems(li || [])
    setSlots(sl || [])
    setCatalog(cat || [])
    setRules(rul || [])
    setItems(it || [])
    setVerification(ver || [])
    setSignoff(
      so || {
        event_id: eventId,
        packed_out_name: '',
        packed_out_id_number: '',
        packed_out_job_title: '',
        checked_out_name: '',
        checked_out_id_number: '',
        checked_out_job_title: '',
        signed_out_name: '',
        signed_out_id_number: '',
        signed_out_job_title: '',
        packed_back_name: '',
        packed_back_id_number: '',
        packed_back_job_title: '',
        checked_back_name: '',
        checked_back_id_number: '',
        checked_back_job_title: '',
        signed_back_name: '',
        signed_back_id_number: '',
        signed_back_job_title: '',
      }
    )
    setLoading(false)
  }

  const lineItemsById = useMemo(() => {
    const m = {}
    lineItems.forEach((li) => (m[li.id] = li))
    return m
  }, [lineItems])

  const catalogById = useMemo(() => {
    const m = {}
    catalog.forEach((c) => (m[c.id] = c))
    return m
  }, [catalog])

  const slotSectionMap = useMemo(() => buildSlotSectionMap(slots, lineItemsById), [slots, lineItemsById])

  // Every posting on the sheet, filled or still vacant — equipment
  // needs to be packed for a posting whether or not an officer has
  // been assigned to it yet.
  const postingSlots = useMemo(
    () => slots.filter((s) => lineItemsById[s.line_item_id]?.row_type === 'LINE ITEM'),
    [slots, lineItemsById]
  )

  async function syncFromPostingSheet() {
    if (isViewer) return
    setSyncing(true)
    try {
      // Rule-generated rows are fully recomputed from the current
      // Posting Sheet + current rules every time — manual rows
      // (Gazebo, Wheelie Bins, etc.) are never touched.
      await supabase.from('event_equipment_items').delete().eq('event_id', eventId).eq('source', 'rule')

      const slotsWithSection = postingSlots.map((slot) => ({
        slot,
        lineItem: lineItemsById[slot.line_item_id],
        ...(slotSectionMap[slot.id] || { phase: 'event_day', posting_category: 'general' }),
      }))
      const freshRows = generateRuleAssignments(eventId, slotsWithSection, rules)
      if (freshRows.length > 0) {
        const concurrency = 200
        for (let i = 0; i < freshRows.length; i += concurrency) {
          const chunk = freshRows.slice(i, i + concurrency)
          const { error } = await supabase.from('event_equipment_items').insert(chunk)
          if (error) throw error
        }
      }
      await load()
    } catch (err) {
      alert('Could not sync equipment: ' + err.message)
    }
    setSyncing(false)
  }

  // Aggregated totals per equipment type, across both rule-generated
  // and manual rows — this is the table Shane actually signs off on.
  const totals = useMemo(() => {
    const byItem = {}
    items.forEach((row) => {
      if (!byItem[row.equipment_item_id]) {
        byItem[row.equipment_item_id] = { equipment_item_id: row.equipment_item_id, qty: 0, rows: [] }
      }
      byItem[row.equipment_item_id].qty += Number(row.qty) || 0
      byItem[row.equipment_item_id].rows.push(row)
    })
    return Object.values(byItem).sort((a, b) => {
      const sa = catalogById[a.equipment_item_id]?.sort_order ?? 999
      const sb = catalogById[b.equipment_item_id]?.sort_order ?? 999
      return sa - sb
    })
  }, [items, catalogById])

  const verificationByItem = useMemo(() => {
    const m = {}
    verification.forEach((v) => (m[v.equipment_item_id] = v))
    return m
  }, [verification])

  // Shared writer for the per-equipment-type verification row — covers
  // the "Verified" tick, the numbers out/back text (e.g. bib numbers),
  // and the "Reconciled" tick, all stored on event_equipment_verification
  // keyed by (event_id, equipment_item_id).
  async function saveVerification(equipmentItemId, patch) {
    if (isViewer) return
    const current = verificationByItem[equipmentItemId] || {
      event_id: eventId,
      equipment_item_id: equipmentItemId,
      verified: false,
      numbers_out: '',
      numbers_back: '',
      numbers_reconciled: false,
    }
    const next = { ...current, ...patch }
    setVerification((prev) => {
      const others = prev.filter((v) => v.equipment_item_id !== equipmentItemId)
      return [...others, next]
    })
    await supabase.from('event_equipment_verification').upsert({
      event_id: eventId,
      equipment_item_id: equipmentItemId,
      verified: !!next.verified,
      verified_at: next.verified ? new Date().toISOString() : current.verified_at || null,
      numbers_out: next.numbers_out || '',
      numbers_back: next.numbers_back || '',
      numbers_reconciled: !!next.numbers_reconciled,
    })
  }

  function toggleVerified(equipmentItemId) {
    const current = verificationByItem[equipmentItemId]
    saveVerification(equipmentItemId, { verified: !current?.verified })
  }

  function toggleReconciled(equipmentItemId) {
    const current = verificationByItem[equipmentItemId]
    saveVerification(equipmentItemId, { numbers_reconciled: !current?.numbers_reconciled })
  }

  async function addManualItem() {
    if (isViewer || !manualForm.equipment_item_id) return
    const qty = Math.max(1, Number(manualForm.qty) || 1)
    const { error } = await supabase.from('event_equipment_items').insert({
      event_id: eventId,
      equipment_item_id: manualForm.equipment_item_id,
      qty,
      source: 'manual',
    })
    if (error) {
      alert('Could not add item: ' + error.message)
      return
    }
    setManualForm({ equipment_item_id: '', qty: 1 })
    load()
  }

  async function removeManualRow(row) {
    if (isViewer) return
    await supabase.from('event_equipment_items').delete().eq('id', row.id)
    setItems((prev) => prev.filter((r) => r.id !== row.id))
  }

  async function updateManualQty(row, qty) {
    const q = Math.max(0, Number(qty) || 0)
    setItems((prev) => prev.map((r) => (r.id === row.id ? { ...r, qty: q } : r)))
    await supabase.from('event_equipment_items').update({ qty: q }).eq('id', row.id)
  }

  async function saveSignoff(patch) {
    const next = { ...signoff, ...patch }
    setSignoff(next)
    await supabase.from('event_equipment_signoff').upsert({ ...next, event_id: eventId, updated_at: new Date().toISOString() })
  }

  if (loading) return <div className="page">Loading…</div>
  if (!event) return <div className="page">Event not found.</div>

  return (
    <div className="page equipment-signout">
      <Header title="Equipment Sign-Out Sheet" />

      <div className="event-meta no-print">
        <Link to="/">← Back to Events</Link>
        <Link to={`/events/${eventId}/posting-sheet`}>Posting Sheet</Link>
        <Link to="/equipment-settings">Catalog &amp; Rules</Link>
        <button onClick={() => window.print()}>Print</button>
        {!isViewer && (
          <button className="btn-primary" onClick={syncFromPostingSheet} disabled={syncing}>
            {syncing ? 'Syncing…' : '⟳ Sync from Posting Sheet'}
          </button>
        )}
        {isViewer && <span className="viewer-badge">View-only access</span>}
      </div>

      <div className="event-meta">
        <div>
          <strong>EVENT NAME:</strong> {event.event_name}
        </div>
        <div>
          <strong>VENUE:</strong> {event.venue}
        </div>
        <div>
          <strong>DATE:</strong> {event.event_date}
        </div>
        <div>
          <strong>TIMING:</strong> {event.timing}
        </div>
      </div>

      <p className="no-print" style={{ maxWidth: 760 }}>
        "Sync from Posting Sheet" rebuilds the auto-issued rows below (bibs / pullovers / cleaning
        gear per officer type) from every posting on the current Posting Sheet and the rules set
        up on the Catalog &amp; Rules page — including postings that don't have an officer
        assigned yet. Equipment is packed once per phase (Build-Up, Breakdown, Event Day) at the
        highest single-day/section count for that phase, not summed across every day, since the
        same kit gets reused. A rule tied to a specific officer type (e.g. cleaning gear tied to
        "Event Cleaner") only shows up here when that type is actually posted on the sheet. Safe
        to run again any time officers or sections change. Items you add manually below (radios,
        gazebos, bins, etc.) are never touched by syncing.
      </p>

      <table className="simple-table equipment-table">
        <thead>
          <tr>
            <th>Equipment Type</th>
            <th>Make</th>
            <th>Qty</th>
            <th>Verified</th>
            <th className="no-print"></th>
          </tr>
        </thead>
        <tbody>
          {totals.length === 0 && (
            <tr>
              <td colSpan={5}>No equipment signed out yet. Hit "Sync from Posting Sheet" above, or add an item manually below.</td>
            </tr>
          )}
          {totals.map((t) => {
            const item = catalogById[t.equipment_item_id]
            const isOpen = !!expanded[t.equipment_item_id]
            const manualRows = t.rows.filter((r) => r.source === 'manual')
            const ruleRows = t.rows.filter((r) => r.source === 'rule')
            return (
              <Fragment key={t.equipment_item_id}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="no-print equipment-expand-btn"
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [t.equipment_item_id]: !prev[t.equipment_item_id] }))
                      }
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                    {item?.name || '(deleted item)'}
                  </td>
                  <td>{item?.default_make || 'N/A'}</td>
                  <td>{t.qty}</td>
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={!!verificationByItem[t.equipment_item_id]?.verified}
                      disabled={isViewer}
                      onChange={() => toggleVerified(t.equipment_item_id)}
                    />
                  </td>
                  <td className="no-print"></td>
                </tr>
                {isOpen && (
                  <tr className="no-print equipment-row-detail">
                    <td colSpan={5}>
                      <div style={{ marginBottom: 10 }}>
                        <strong>Numbers out / back (e.g. bib numbers):</strong>
                        <div className="inline-form">
                          <input
                            placeholder="Numbers issued (e.g. 12, 14, 19)"
                            style={{ minWidth: 220 }}
                            value={verificationByItem[t.equipment_item_id]?.numbers_out || ''}
                            disabled={isViewer}
                            onChange={(e) => saveVerification(t.equipment_item_id, { numbers_out: e.target.value })}
                          />
                          <input
                            placeholder="Numbers returned"
                            style={{ minWidth: 220 }}
                            value={verificationByItem[t.equipment_item_id]?.numbers_back || ''}
                            disabled={isViewer}
                            onChange={(e) => saveVerification(t.equipment_item_id, { numbers_back: e.target.value })}
                          />
                          <label style={{ whiteSpace: 'nowrap' }}>
                            <input
                              type="checkbox"
                              checked={!!verificationByItem[t.equipment_item_id]?.numbers_reconciled}
                              disabled={isViewer}
                              onChange={() => toggleReconciled(t.equipment_item_id)}
                            />{' '}
                            Reconciled
                          </label>
                        </div>
                      </div>
                      {ruleRows.length > 0 && (
                        <div>
                          <strong>Auto-issued (from Posting Sheet rules):</strong>
                          <ul>
                            {ruleRows.map((r) => <li key={r.id}>{r.officer_label || `${r.qty} needed`}</li>)}
                          </ul>
                        </div>
                      )}
                      {manualRows.length > 0 && (
                        <div>
                          <strong>Manual entries:</strong>
                          <ul>
                            {manualRows.map((r) => (
                              <li key={r.id}>
                                <input
                                  type="number"
                                  min="0"
                                  style={{ width: 70 }}
                                  value={r.qty}
                                  disabled={isViewer}
                                  onChange={(e) => updateManualQty(r, e.target.value)}
                                />
                                {!isViewer && (
                                  <button className="btn-delete" onClick={() => removeManualRow(r)}>
                                    Remove
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {!isViewer && (
        <div className="inline-form no-print" style={{ marginTop: 12 }}>
          <select
            value={manualForm.equipment_item_id}
            onChange={(e) => setManualForm({ ...manualForm, equipment_item_id: e.target.value })}
          >
            <option value="">— Add an equipment item manually —</option>
            {catalog
              .filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <input
            type="number"
            min="1"
            style={{ maxWidth: 80 }}
            value={manualForm.qty}
            onChange={(e) => setManualForm({ ...manualForm, qty: e.target.value })}
          />
          <button className="btn-primary" disabled={!manualForm.equipment_item_id} onClick={addManualItem}>
            + Add Item
          </button>
        </div>
      )}

      <div className="equipment-signoff-footer">
        <h3 style={{ marginTop: 0 }}>OUT</h3>
        <h4>1. Packed By</h4>
        <div className="inline-form">
          <input
            placeholder="Name & Surname"
            value={signoff?.packed_out_name || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ packed_out_name: e.target.value })}
          />
          <input
            placeholder="ID No."
            value={signoff?.packed_out_id_number || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ packed_out_id_number: e.target.value })}
          />
          <input
            placeholder="Job Title"
            value={signoff?.packed_out_job_title || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ packed_out_job_title: e.target.value })}
          />
        </div>
        <h4>2. Checked By</h4>
        <div className="inline-form">
          <input
            placeholder="Name & Surname"
            value={signoff?.checked_out_name || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ checked_out_name: e.target.value })}
          />
          <input
            placeholder="ID No."
            value={signoff?.checked_out_id_number || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ checked_out_id_number: e.target.value })}
          />
          <input
            placeholder="Job Title"
            value={signoff?.checked_out_job_title || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ checked_out_job_title: e.target.value })}
          />
        </div>
        <h4>3. Signed Out By</h4>
        <div className="inline-form">
          <input
            placeholder="Name & Surname"
            value={signoff?.signed_out_name || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ signed_out_name: e.target.value })}
          />
          <input
            placeholder="ID No."
            value={signoff?.signed_out_id_number || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ signed_out_id_number: e.target.value })}
          />
          <input
            placeholder="Job Title"
            value={signoff?.signed_out_job_title || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ signed_out_job_title: e.target.value })}
          />
        </div>

        <h3>BACK IN</h3>
        <h4>4. Packed By</h4>
        <div className="inline-form">
          <input
            placeholder="Name & Surname"
            value={signoff?.packed_back_name || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ packed_back_name: e.target.value })}
          />
          <input
            placeholder="ID No."
            value={signoff?.packed_back_id_number || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ packed_back_id_number: e.target.value })}
          />
          <input
            placeholder="Job Title"
            value={signoff?.packed_back_job_title || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ packed_back_job_title: e.target.value })}
          />
        </div>
        <h4>5. Checked By</h4>
        <div className="inline-form">
          <input
            placeholder="Name & Surname"
            value={signoff?.checked_back_name || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ checked_back_name: e.target.value })}
          />
          <input
            placeholder="ID No."
            value={signoff?.checked_back_id_number || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ checked_back_id_number: e.target.value })}
          />
          <input
            placeholder="Job Title"
            value={signoff?.checked_back_job_title || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ checked_back_job_title: e.target.value })}
          />
        </div>
        <h4>6. Signed Back By</h4>
        <div className="inline-form">
          <input
            placeholder="Name & Surname"
            value={signoff?.signed_back_name || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ signed_back_name: e.target.value })}
          />
          <input
            placeholder="ID No."
            value={signoff?.signed_back_id_number || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ signed_back_id_number: e.target.value })}
          />
          <input
            placeholder="Job Title"
            value={signoff?.signed_back_job_title || ''}
            disabled={isViewer}
            onChange={(e) => saveSignoff({ signed_back_job_title: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}
