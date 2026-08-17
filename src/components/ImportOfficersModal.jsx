import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'

const TARGET_FIELDS = [
  { key: 'full_name', label: 'Full Name' },
  { key: 'id_number', label: 'ID Number' },
  { key: 'psira_number', label: 'PSIRA Number' },
  { key: 'phone_number', label: 'Phone Number' },
]

const GUESS_PATTERNS = {
  full_name: /name|surname/i,
  id_number: /id.*(no|number)|identity|^id$/i,
  psira_number: /psira.*(no|number)/i,
  phone_number: /phone|cell|mobile|contact/i,
}

function guessMapping(headers) {
  const mapping = {}
  for (const field of Object.keys(GUESS_PATTERNS)) {
    const match = headers.find((h) => GUESS_PATTERNS[field].test(h.trim()))
    if (match) mapping[field] = match
  }
  return mapping
}

export default function ImportOfficersModal({ existingOfficers, onClose, onImported }) {
  const [step, setStep] = useState('upload') // upload | preview | importing | done
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setError('')
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        if (json.length === 0) {
          setError('That sheet looks empty — check you picked the right tab.')
          return
        }
        const detectedHeaders = Object.keys(json[0])
        setHeaders(detectedHeaders)
        setRows(json)
        setMapping(guessMapping(detectedHeaders))
        setStep('preview')
      } catch (err) {
        setError('Could not read that file. Make sure it is a .xlsx or .xls file.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function buildOfficer(row) {
    return {
      full_name: mapping.full_name ? String(row[mapping.full_name] || '').trim() : '',
      id_number: mapping.id_number ? String(row[mapping.id_number] || '').trim() : '',
      psira_number: mapping.psira_number ? String(row[mapping.psira_number] || '').trim() : '',
      phone_number: mapping.phone_number ? String(row[mapping.phone_number] || '').trim() : '',
      special_events: false,
      active: true,
    }
  }

  async function runImport() {
    setStep('importing')
    const existingIds = new Set(
      existingOfficers.map((o) => (o.id_number || '').trim()).filter(Boolean)
    )
    const seenInFile = new Set()
    const toInsert = []
    let skippedNoName = 0
    let skippedDuplicate = 0

    for (const row of rows) {
      const officer = buildOfficer(row)
      if (!officer.full_name) {
        skippedNoName += 1
        continue
      }
      const idKey = officer.id_number
      if (idKey && (existingIds.has(idKey) || seenInFile.has(idKey))) {
        skippedDuplicate += 1
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

    setResults({
      inserted,
      failed,
      skippedNoName,
      skippedDuplicate,
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

            <p>
              <strong>Preview (first 5 rows):</strong>
            </p>
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID Number</th>
                  <th>PSIRA No.</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((row, i) => {
                  const o = buildOfficer(row)
                  return (
                    <tr key={i}>
                      <td>{o.full_name}</td>
                      <td>{o.id_number}</td>
                      <td>{o.psira_number}</td>
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

        {step === 'importing' && <p>Importing… please wait.</p>}

        {step === 'done' && results && (
          <>
            <p>
              <strong>{results.inserted}</strong> officers imported
              successfully.
            </p>
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
