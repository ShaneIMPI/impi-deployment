import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { parseQuotationFile } from '../lib/parseQuotation'
import { expandLineItemsToSlots } from '../lib/postingLogic'
import { getIsViewer } from '../lib/roles'
import Header from '../components/Header'

export default function EventUpload() {
  const navigate = useNavigate()
  const [parsed, setParsed] = useState(null) // { setup, lineItems }
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [newTypesFound, setNewTypesFound] = useState([])
  const [isViewer, setIsViewer] = useState(false)

  useEffect(() => {
    getIsViewer().then(setIsViewer)
  }, [])

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setError('')
    setFileName(file.name)
    try {
      const result = await parseQuotationFile(file)
      if (result.lineItems.length === 0) {
        setError(
          "No posting line items were found. This usually means the file isn't built from " +
          'the IMPI Builder template. Please recreate this quote using the standard template ' +
          '(download link below), then upload again.'
        )
        return
      }
      setParsed(result)

      // check which Officer Types aren't in the master rate card yet
      const { data: existingTypes } = await supabase
        .from('officer_types')
        .select('type_name')
      const existingNames = new Set((existingTypes || []).map((t) => t.type_name))
      const found = [
        ...new Set(
          result.lineItems
            .filter((li) => li.rowType === 'LINE ITEM' && li.officerTypeName)
            .map((li) => li.officerTypeName)
            .filter((name) => !existingNames.has(name))
        ),
      ]
      setNewTypesFound(found)
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  async function handleConfirm() {
    if (!parsed) return
    setSaving(true)
    setError('')
    try {
      // 1. Create any missing Officer Types with placeholder rates so
      //    nothing silently falls through — Shane fills in real rates
      //    on the Officer Types screen afterward.
      if (newTypesFound.length > 0) {
        const rows = newTypesFound.map((type_name) => ({
          type_name,
          psira_grade: 'N/A',
          sell_price: 0,
          pay_rate: 0,
        }))
        await supabase.from('officer_types').insert(rows)
      }

      // 2. Create the event
      const { setup, lineItems } = parsed
      const { data: eventRow, error: eventErr } = await supabase
        .from('events')
        .insert({
          event_name: setup.eventName || fileName.replace(/\.[^.]+$/, ''),
          venue: setup.venue || '',
          event_date: setup.eventDate || '',
          timing: setup.timing || '',
          quotation_ref: setup.quotationRef || '',
          status: 'draft',
        })
        .select()
        .single()
      if (eventErr) throw eventErr

      // 3. Insert quote_line_items, keep returned ids in original order
      const lineItemRows = lineItems.map((li) => ({
        event_id: eventRow.id,
        row_type: li.rowType,
        sort_order: li.sortOrder,
        category: li.category,
        item_date: li.itemDate,
        shift_name: li.shiftName,
        start_time: li.startTime,
        end_time: li.endTime,
        section_text: li.sectionText,
        qty: li.qty,
        officer_type_name: li.officerTypeName,
        posting_location: li.postingLocation,
        shifts: li.shifts,
      }))
      const { data: insertedLineItems, error: liErr } = await supabase
        .from('quote_line_items')
        .insert(lineItemRows)
        .select()
      if (liErr) throw liErr

      // Supabase doesn't guarantee insert-order on return, so re-sort by sort_order
      const sortedLineItems = [...insertedLineItems].sort(
        (a, b) => a.sort_order - b.sort_order
      )

      // 4. Expand into posting slots
      const slotPlan = expandLineItemsToSlots(lineItems)
      const slotRows = slotPlan.map((s) => ({
        event_id: eventRow.id,
        line_item_id: sortedLineItems[s.lineItemIndex].id,
        slot_index: s.slotIndex,
        sort_order: s.sortOrder,
        status: 'vacant',
      }))
      const { error: slotErr } = await supabase.from('posting_slots').insert(slotRows)
      if (slotErr) throw slotErr

      navigate(`/events/${eventRow.id}/posting-sheet`)
    } catch (err) {
      setError(err.message || String(err))
      setSaving(false)
    }
  }

  if (isViewer) {
    return (
      <div className="page">
        <Header title="New Event — Upload Quotation" />
        <p>Your account has view-only access — creating new events isn't available.</p>
        <Link to="/">← Back to Events</Link>
      </div>
    )
  }

  return (
    <div className="page">
      <Header title="New Event — Upload Quotation" />
      <p>
        Upload the quotation <strong>.xlsx</strong> file (the one with the Setup and
        Builder tabs). PDF is not supported — the Builder sheet is what drives the
        posting sheet.
      </p>
      <input type="file" accept=".xlsx" onChange={handleFile} />
      <p>
        <a href={`${import.meta.env.BASE_URL}IMPI-Quotation-Template.xlsx`} download>
          Download the blank IMPI Quotation Template (.xlsx)
        </a>
      </p>

      {error && <p className="error-text">{error}</p>}

      {parsed && (
        <div className="preview-block">
          <h2>Preview</h2>
          <p>
            <strong>{parsed.setup.eventName}</strong>
            <br />
            {parsed.setup.venue} — {parsed.setup.eventDate} ({parsed.setup.timing})
          </p>
          <p>{parsed.lineItems.filter((l) => l.rowType === 'LINE ITEM').length} posting line items found.</p>

          {newTypesFound.length > 0 && (
            <div className="warning-box">
              <strong>New Officer Types found (not yet in your rate card):</strong>
              <ul>
                {newTypesFound.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p>
                These will be added with placeholder rates (R0) — remember to set
                their real PSIRA grade and Pay Rate on the Officer Types screen
                afterward.
              </p>
            </div>
          )}

          <table className="simple-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Qty</th>
                <th>Officer Type</th>
                <th>Posting</th>
              </tr>
            </thead>
            <tbody>
              {parsed.lineItems.map((li, i) => (
                <tr key={i} className={li.rowType === 'SECTION HEADER' ? 'section-row' : ''}>
                  {li.rowType === 'SECTION HEADER' ? (
                    <td colSpan={4}>{li.sectionText}</td>
                  ) : (
                    <>
                      <td></td>
                      <td>{li.qty}</td>
                      <td>{li.officerTypeName}</td>
                      <td>{li.postingLocation}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <button className="btn-primary" onClick={handleConfirm} disabled={saving}>
            {saving ? 'Creating Event…' : 'Confirm & Generate Posting Sheet'}
          </button>
        </div>
      )}
    </div>
  )
}
