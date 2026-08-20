import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'

const TARGET_FIELDS = [
  { key: 'full_name', label: 'Name and Surname' },
  { key: 'id_number', label: 'ID Number' },
  { key: 'psira_number', label: 'PSIRA Number' },
  { key: 'psira_grade', label: 'PSIRA Grade' },
  { key: 'special_events', label: 'Special Events (Y/N)' },
]

const GUESS_PATTERNS = {
  full_name: /name|surname/i,
  id_number: /id.*(no|number)|identity|^id$/i,
  psira_number: /^psira$|psira.*(no|number)/i,
  psira_grade: /grade/i,
  special_events: /special/i,
}

function guessMapping(headers) {
  const mapping = {}
  for (const field of Object.keys(GUESS_PATTERNS)) {
    const match = headers.find((h) => GUESS_PATTERNS[field].test(h.trim()))
    if (match) mapping[field] = match
  }
  return mapping
}

function toBool(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === 'y' || v === 'yes' || v === 'true' || v === '1'
}

// Rough "does this sheet look like broken formula output" check — Excel
// workbooks with unresolved VLOOKUPs commonly show literal #N/A (or other
// #ERROR-style) text once converted to plain values.
function countErrorCells(rows, headers) {
  let count = 0
  for (const row of rows) {
    for (const h of headers) {
      if (String(row[h] ?? '').trim().startsWith('#')) count += 1
    }
  }
  return count
}

export default function ImportOfficersModal({ existingOfficers, onClose, onImported }) {
  const [step, setStep] = useState('upload') // upload | preview | importing | done
  const [workbook, setWorkbook] = useState(null)
  const [sheetNames, setSheetNames] = useState([])
  const [selectedSheet, setSelectedSheet] = useState('')
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [errorCellCount, setErrorCellCount] = useState(0)
  const [mapping, setMapping] = useState({})
  const [updateExisting, setUpdateExisting] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')

  function loadSheet(wb, sheetName) {
    const sheet = wb.Sheets[sheetName]
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    if (json.length === 0) {
      setHeaders([])
      setRows([])
      setErrorCellCount(0)
      setError('That sheet looks empty — try picking a different one below.')
      return
    }
    const detectedHeaders = Object.keys(json[0])
    setHeaders(detectedHeaders)
    setRows(json)
    setErrorCellCount(countErrorCells(json, detectedHeaders))
    setMapping(guessMapping(detectedHeaders))
    setError('')
  }

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setError('')
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' })
        if (wb.SheetNames.length === 0) {
          setError('That file has no sheets in it.')
          return
        }
        setWorkbook(wb)
        setSheetNames(wb.SheetNames)
        setSelectedSheet(wb.SheetNames[0])
        loadSheet(wb, wb.SheetNames[0])
        setStep('preview')
      } catch (err) {
        setError('Could not read that file. Make sure it is a .xlsx or .xls file.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function handleSheetChange(name) {
    setSelectedSheet(name)
    loadSheet(workbook, name)
  }

  function buildOfficer(row) {
    const rawName = mapping.full_name ? String(row[mapping.full_name] || '').trim() : ''
    const parts = rawName.split(/\s+/).filter(Boolean)
    const first_name = parts.shift() || ''
    const last_name = parts.join(' ')
    return {
      first_name,
      last_name,
      id_number: mapping.id_number ? String(row[mapping.id_number] || '').trim() : '',
      psira_number: mapping.psira_number ? String(row[mapping.psira_number] || '').trim() : '',
      psira_grade: mapping.psira_grade ? String(row[mapping.psira_grade] || '').trim() : '',
      special_events: mapping.special_events ? toBool(row[mapping.special_events]) : false,
    }
  }

  async function runImport() {
    setStep('importing')
    const existingByIdNumber = new Map(
      existingOfficers
        .filter((o) => (o.id_number || '').trim())
        .map((o) => [o.id_number.trim(), o])
    )
    const seenInFile = new Set()
    const toInsert = []
    const toUpdate = []
    let skippedNoName = 0
    let skippedDuplicate = 0

    for (const row of rows) {
      const officer = buildOfficer(row)
      if (!officer.first_name && !officer.last_name) {
        skippedNoName += 1
        continue
      }
      const idKey = officer.id_number
      const existing = idKey ? existingByIdNumber.get(idKey) : null
      if (idKey && (existing || seenInFile.has(idKey))) {
        if (existing && updateExisting && mapping.special_events) {
          toUpdate.push({ id: existing.id, special_events: officer.special_events })
        } else {
          skippedDuplicate += 1
        }
        continue
      }
      if (idKey) seenInFile.add(idKey)
      toInsert.push(officer)
    }

    let inserted = 0
    let failed = 0
    let lastErrorMessage = ''
    const chunkSize = 100
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize)
      const { error: insertError, data } = await supabase.from('officers').insert(chunk).select()
      if (insertError) {
        failed += chunk.length
        lastErrorMessage = insertError.message
      } else {
        inserted += data?.length || chunk.length
      }
    }

    // Update existing officers' Special Events flag, a batch of concurrent
    // requests at a time so a few hundred rows doesn't take forever.
    let updated = 0
    let updateFailed = 0
    const concurrency = 20
    for (let i = 0; i < toUpdate.length; i += concurrency) {
      const chunk = toUpdate.slice(i, i + concurrency)
      const outcomes = await Promise.all(
        chunk.map((o) =>
          supabase.from('officers').update({ special_events: o.special_events }).eq('id', o.id)
        )
      )
      for (const outcome of outcomes) {
        if (outcome.error) {
          updateFailed += 1
          lastErrorMessage = outcome.error.message
        } else {
          updated += 1
        }
      }
    }

    setResults({
      inserted,
      failed,
      skippedNoName,
      skippedDuplicate,
      updated,
      updateFailed,
      total: rows.length,
      lastErrorMessage,
    })
    setStep('done')
    onImported()
  }

  return (
    <div className="signature-overlay">
      <div className="signature-modal import-modal">
        <h3>Import Officers from Excel</h3>

        {step === 'upload' && (
          <>
            <p>
              Upload the .xlsx or .xls file. The first row must be column
              headers (Name, ID Number, PSIRA Number, etc.) — the exact
              wording doesn't matter, you'll match them up on the next step.
              If the file has more than one sheet/tab, you'll be able to
              pick the right one afterward.
            </p>
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} />
            {error && <p className="error-text">{error}</p>}
            <div className="signature-actions">
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <>
            {sheetNames.length > 1 && (
              <label className="import-mapping-row" style={{ marginBottom: 12 }}>
                <span>
                  This file has {sheetNames.length} sheets — which one has the officer
                  list?
                </span>
                <select value={selectedSheet} onChange={(e) => handleSheetChange(e.target.value)}>
                  {sheetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {errorCellCount > 0 && (
              <p className="error-text">
                ⚠ This sheet has {errorCellCount} cells starting with "#" (like #N/A) —
                that usually means it's a formula/lookup sheet with broken links, not your
                real source data. {sheetNames.length > 1 ? 'Try a different sheet above.' : ''}
              </p>
            )}

            {error && <p className="error-text">{error}</p>}

            {rows.length > 0 && (
              <>
                <p>
                  Found <strong>{rows.length}</strong> rows. Match each field
                  below to the correct column from your file, then check the
                  preview.
                </p>
                <div className="import-mapping-grid">
                  {TARGET_FIELDS.map((f) => (
                    <label key={f.key} className="import-mapping-row">
                      <span>{f.label}</span>
                      <select
                        value={mapping[f.key] || ''}
                        onChange={(e) =>
                          setMapping({ ...mapping, [f.key]: e.target.value || undefined })
                        }
                      >
                        <option value="">— Not in file —</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>

                {mapping.special_events && (
                  <label className="import-mapping-row" style={{ marginTop: 4 }}>
                    <span>
                      <input
                        type="checkbox"
                        checked={updateExisting}
                        onChange={(e) => setUpdateExisting(e.target.checked)}
                      />{' '}
                      Also update Special Events for officers already on the roster
                      (matched by ID Number), instead of skipping them
                    </span>
                  </label>
                )}

                <p>
                  <strong>Preview (first 5 rows):</strong>
                </p>
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>ID Number</th>
                      <th>PSIRA No.</th>
                      <th>PSIRA Grade</th>
                      <th>Special Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((row, i) => {
                      const o = buildOfficer(row)
                      return (
                        <tr key={i}>
                          <td>
                            {o.first_name} {o.last_name}
                          </td>
                          <td>{o.id_number}</td>
                          <td>{o.psira_number}</td>
                          <td>{o.psira_grade}</td>
                          <td>{o.special_events ? 'Yes' : 'No'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                <div className="signature-actions">
                  <button onClick={() => setStep('upload')}>Back</button>
                  <button className="btn-primary" onClick={runImport}>
                    Import {rows.length} Officers
                  </button>
                  <button onClick={onClose}>Cancel</button>
                </div>
              </>
            )}
          </>
        )}

        {step === 'importing' && <p>Importing… please wait.</p>}

        {step === 'done' && results && (
          <>
            <p>
              <strong>{results.inserted}</strong> new officers imported
              successfully.
            </p>
            {results.updated > 0 && (
              <p>
                <strong>{results.updated}</strong> existing officers had their Special
                Events flag updated.
              </p>
            )}
            {results.skippedDuplicate > 0 && (
              <p>
                {results.skippedDuplicate} skipped — already on the roster
                (matched by ID number).
              </p>
            )}
            {results.skippedNoName > 0 && (
              <p>{results.skippedNoName} skipped — no name found in that row.</p>
            )}
            {results.failed > 0 && (
              <p className="error-text">
                {results.failed} failed to save
                {results.lastErrorMessage ? `: ${results.lastErrorMessage}` : ''} — please
                check those rows and try again.
              </p>
            )}
            {results.updateFailed > 0 && (
              <p className="error-text">
                {results.updateFailed} Special Events updates failed
                {results.lastErrorMessage ? `: ${results.lastErrorMessage}` : ''}.
              </p>
            )}
            <div className="signature-actions">
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
