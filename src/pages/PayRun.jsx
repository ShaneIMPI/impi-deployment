import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { deriveSlotView } from '../lib/postingLogic'
import Header from '../components/Header'

export default function PayRun() {
  const { eventId } = useParams()
  const [event, setEvent] = useState(null)
  const [lineItems, setLineItems] = useState([])
  const [slots, setSlots] = useState([])
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [eventId])

  async function load() {
    setLoading(true)
    const [{ data: ev }, { data: li }, { data: sl }, { data: ty }] = await Promise.all([
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
    ])
    setEvent(ev)
    setLineItems(li || [])
    setSlots(sl || [])
    setTypes(ty || [])
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

  function exportCsv() {
    const rows = [['No.', 'Name & Surname', 'ID Number', 'PSIRA No.', 'BIB No.', 'Posting', 'Pay Rate', 'Shifts', 'Amount', 'Confirmed']]
    let counter = 0
    let total = 0
    slots.forEach((slot) => {
      const lineItem = lineItemsById[slot.line_item_id]
      if (!lineItem) return
      if (lineItem.row_type === 'SECTION HEADER') {
        rows.push([lineItem.section_text])
        return
      }
      counter += 1
      const officerType = typesByName[lineItem.officer_type_name]
      const view = deriveSlotView(slot, lineItem, officerType)
      total += view.payAmount
      rows.push([
        counter,
        `${slot.first_name || ''} ${slot.last_name || ''}`.trim(),
        slot.id_number || '',
        slot.psira_number || '',
        slot.bib_serial || '',
        view.posting,
        view.payRate,
        view.shifts,
        view.payAmount.toFixed(2),
        slot.signature_data ? 'Yes' : 'No',
      ])
    })
    rows.push([])
    rows.push(['', '', '', '', '', '', '', 'TOTAL', total.toFixed(2)])

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${event?.event_name || 'pay-run'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="page">Loading…</div>
  if (!event) return <div className="page">Event not found.</div>

  let counter = 0
  let total = 0

  return (
    <div className="page posting-sheet">
      <Header title="Pay Run — Security" />

      <div className="event-meta no-print">
        <Link to="/">← Back to Events</Link>
        <button onClick={() => window.print()}>Print</button>
        <button onClick={exportCsv}>Export CSV</button>
      </div>

      <div className="event-meta">
        <div>
          <strong>EVENT NAME:</strong> {event.event_name}
        </div>
        <div>
          <strong>OVERVIEW DATE:</strong> {event.event_date}
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
            <th>Pay Rate</th>
            <th>Shifts</th>
            <th>Amount</th>
            <th>Confirmed</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => {
            const lineItem = lineItemsById[slot.line_item_id]
            if (!lineItem) return null

            if (lineItem.row_type === 'SECTION HEADER') {
              counter = 0
              return (
                <tr key={slot.id} className="section-row">
                  <td colSpan={10}>{lineItem.section_text}</td>
                </tr>
              )
            }

            counter += 1
            const officerType = typesByName[lineItem.officer_type_name]
            const view = deriveSlotView(slot, lineItem, officerType)
            total += view.payAmount

            return (
              <tr key={slot.id}>
                <td>{counter}</td>
                <td>{`${slot.first_name || ''} ${slot.last_name || ''}`.trim()}</td>
                <td>{slot.id_number}</td>
                <td>{slot.psira_number}</td>
                <td>{slot.bib_serial}</td>
                <td>{view.posting}</td>
                <td>R {Number(view.payRate).toFixed(2)}</td>
                <td>{view.shifts}</td>
                <td>R {view.payAmount.toFixed(2)}</td>
                <td className="checkbox-cell">
                  {slot.signature_data ? '✅' : '—'}
                </td>
              </tr>
            )
          })}
          <tr className="total-row">
            <td colSpan={8} style={{ textAlign: 'right' }}>
              <strong>TOTAL</strong>
            </td>
            <td>
              <strong>R {total.toFixed(2)}</strong>
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
