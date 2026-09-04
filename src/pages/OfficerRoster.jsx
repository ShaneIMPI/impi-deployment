import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { getIsViewer } from '../lib/roles'
import { REGIONS } from '../lib/regions'
import Header from '../components/Header'
import ImportOfficersModal from '../components/ImportOfficersModal'

const emptyOfficer = {
  name: '',
  id_number: '',
  psira_number: '',
  psira_grade: '',
  special_events: false,
}

const emptyRate = {
  type_name: '',
  region: 'Gauteng',
  psira_grade: '',
  sell_price: '',
  pay_rate: '',
}

export default function OfficerRoster() {
  const [officers, setOfficers] = useState([])
  const [types, setTypes] = useState([])
  const [form, setForm] = useState(emptyOfficer)
  const [editingId, setEditingId] = useState(null)
  const [tab, setTab] = useState('officers')
  const [isViewer, setIsViewer] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [rateForm, setRateForm] = useState(emptyRate)
  const [rateError, setRateError] = useState('')

  useEffect(() => {
    loadOfficers()
    loadTypes()
    getIsViewer().then(setIsViewer)
  }, [])

  async function loadOfficers() {
    const { data } = await supabase
      .from('officers')
      .select('*')
      .order('last_name', { ascending: true })
    setOfficers(data || [])
  }

  async function loadTypes() {
    const { data } = await supabase
      .from('officer_types')
      .select('*')
      .order('type_name', { ascending: true })
      .order('region', { ascending: true })
    setTypes(data || [])
  }

  function startEdit(o) {
    setEditingId(o.id)
    setForm({
      name: [o.first_name, o.last_name].filter(Boolean).join(' '),
      id_number: o.id_number || '',
      psira_number: o.psira_number || '',
      psira_grade: o.psira_grade || '',
      special_events: !!o.special_events,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyOfficer)
  }

  async function saveOfficer(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaveError('')
    const parts = form.name.trim().split(/\s+/)
    const first_name = parts.shift() || ''
    const last_name = parts.join(' ')
    const payload = {
      first_name,
      last_name,
      id_number: form.id_number,
      psira_number: form.psira_number,
      psira_grade: form.psira_grade,
      special_events: form.special_events,
    }
    const { error } = editingId
      ? await supabase.from('officers').update(payload).eq('id', editingId)
      : await supabase.from('officers').insert(payload)
    if (error) {
      setSaveError(error.message)
      return
    }
    setForm(emptyOfficer)
    setEditingId(null)
    loadOfficers()
  }

  async function removeOfficer(id) {
    if (!confirm('Remove this officer from the roster?')) return
    setSaveError('')
    const { error } = await supabase.from('officers').delete().eq('id', id)
    if (error) {
      setSaveError(error.message)
      return
    }
    if (editingId === id) cancelEdit()
    loadOfficers()
  }

  async function updateType(id, field, value) {
    setTypes((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)))
  }

  async function saveType(t) {
    await supabase
      .from('officer_types')
      .update({
        psira_grade: t.psira_grade,
        region: t.region || null,
        sell_price: Number(t.sell_price) || 0,
        pay_rate: Number(t.pay_rate) || 0,
      })
      .eq('id', t.id)
  }

  async function removeType(id) {
    if (!confirm('Remove this rate card entry?')) return
    await supabase.from('officer_types').delete().eq('id', id)
    loadTypes()
  }

  async function addRate(e) {
    e.preventDefault()
    if (!rateForm.type_name.trim()) return
    setRateError('')
    const { error } = await supabase.from('officer_types').insert({
      type_name: rateForm.type_name.trim(),
      region: rateForm.region || null,
      psira_grade: rateForm.psira_grade,
      sell_price: Number(rateForm.sell_price) || 0,
      pay_rate: Number(rateForm.pay_rate) || 0,
    })
    if (error) {
      setRateError(error.message)
      return
    }
    setRateForm(emptyRate)
    loadTypes()
  }

  const existingTypeNames = [...new Set(types.map((t) => t.type_name))]

  return (
    <div className="page">
      <Header title="Officer Roster & Rate Card" />
      <nav className="top-nav">
        <button
          className={tab === 'officers' ? 'tab active' : 'tab'}
          onClick={() => setTab('officers')}
        >
          Officer Roster
        </button>
        <button
          className={tab === 'types' ? 'tab active' : 'tab'}
          onClick={() => setTab('types')}
        >
          Rate Card (Officer Types)
        </button>
        {isViewer && <span className="viewer-badge">View-only access</span>}
      </nav>

      {tab === 'officers' && (
        <>
          {saveError && <p className="error-text">Save failed: {saveError}</p>}
          {!isViewer && (
            <div className="event-meta no-print" style={{ marginBottom: 8 }}>
              <button onClick={() => setShowImport(true)}>Import from Excel</button>
            </div>
          )}
          {!isViewer && (
            <form onSubmit={saveOfficer} className="inline-form">
              <input
                placeholder="Name and Surname"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                placeholder="ID Number"
                value={form.id_number}
                onChange={(e) => setForm({ ...form, id_number: e.target.value })}
              />
              <input
                placeholder="PSIRA Number"
                value={form.psira_number}
                onChange={(e) => setForm({ ...form, psira_number: e.target.value })}
              />
              <input
                placeholder="PSIRA Grade (e.g. Gr C)"
                value={form.psira_grade}
                onChange={(e) => setForm({ ...form, psira_grade: e.target.value })}
              />
              <label className="section-break-toggle">
                <input
                  type="checkbox"
                  checked={form.special_events}
                  onChange={(e) => setForm({ ...form, special_events: e.target.checked })}
                />
                Special Events
              </label>
              <button type="submit" className="btn-primary">
                {editingId ? 'Save Changes' : 'Add Officer'}
              </button>
              {editingId && (
                <button type="button" onClick={cancelEdit}>
                  Cancel
                </button>
              )}
            </form>
          )}

          <table className="simple-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID Number</th>
                <th>PSIRA No.</th>
                <th>PSIRA Grade</th>
                <th>Special Events</th>
                {!isViewer && <th></th>}
              </tr>
            </thead>
            <tbody>
              {officers.map((o) => (
                <tr key={o.id} className={editingId === o.id ? 'warning-cell' : ''}>
                  <td>
                    {o.first_name} {o.last_name}
                  </td>
                  <td>{o.id_number}</td>
                  <td>{o.psira_number}</td>
                  <td>{o.psira_grade}</td>
                  <td>{o.special_events ? 'Yes' : 'No'}</td>
                  {!isViewer && (
                    <td className="row-actions">
                      <a onClick={() => startEdit(o)} style={{ cursor: 'pointer' }}>
                        Edit
                      </a>
                      <a onClick={() => removeOfficer(o.id)} style={{ cursor: 'pointer' }}>
                        Remove
                      </a>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === 'types' && (
        <>
          <p>
            This is the single master rate card used everywhere — the Posting
            Sheet, Special Events check, and Pay Run all pull from here.{' '}
            <strong>Gauteng is the default region</strong> — every event uses the
            Gauteng rate unless its Region is explicitly set to Cape Town on its
            Posting Sheet (Edit Event Details), or changed directly on its Pay Run
            page. Only add a Cape Town row for a role once its price actually
            differs there.
          </p>

          {rateError && <p className="error-text">Save failed: {rateError}</p>}

          {!isViewer && (
            <form onSubmit={addRate} className="inline-form">
              <input
                list="rate-type-options"
                placeholder="Officer Type (e.g. Event Security Officer Gr C)"
                value={rateForm.type_name}
                onChange={(e) => setRateForm({ ...rateForm, type_name: e.target.value })}
              />
              <datalist id="rate-type-options">
                {existingTypeNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <select
                value={rateForm.region}
                onChange={(e) => setRateForm({ ...rateForm, region: e.target.value })}
              >
                <option value="">All Regions (fallback only)</option>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input
                placeholder="PSIRA Grade"
                value={rateForm.psira_grade}
                onChange={(e) => setRateForm({ ...rateForm, psira_grade: e.target.value })}
              />
              <input
                type="number"
                placeholder="Sell Price"
                value={rateForm.sell_price}
                onChange={(e) => setRateForm({ ...rateForm, sell_price: e.target.value })}
              />
              <input
                type="number"
                placeholder="Pay Rate"
                value={rateForm.pay_rate}
                onChange={(e) => setRateForm({ ...rateForm, pay_rate: e.target.value })}
              />
              <button type="submit" className="btn-primary">
                Add Rate
              </button>
            </form>
          )}

          <table className="simple-table">
            <thead>
              <tr>
                <th>Officer Type</th>
                <th>Region</th>
                <th>PSIRA Grade</th>
                <th>Sell Price (per shift)</th>
                <th>Pay Rate (per shift)</th>
                {!isViewer && <th></th>}
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td>{t.type_name}</td>
                  <td>
                    <select
                      value={t.region || ''}
                      disabled={isViewer}
                      onChange={(e) => updateType(t.id, 'region', e.target.value)}
                    >
                      <option value="">All Regions (fallback only)</option>
                      {REGIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={t.psira_grade || ''}
                      disabled={isViewer}
                      onChange={(e) => updateType(t.id, 'psira_grade', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={t.sell_price}
                      disabled={isViewer}
                      onChange={(e) => updateType(t.id, 'sell_price', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={t.pay_rate}
                      disabled={isViewer}
                      onChange={(e) => updateType(t.id, 'pay_rate', e.target.value)}
                    />
                  </td>
                  {!isViewer && (
                    <td className="row-actions">
                      <button onClick={() => saveType(t)}>Save</button>
                      <a onClick={() => removeType(t.id)} style={{ cursor: 'pointer' }}>
                        Remove
                      </a>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {showImport && (
        <ImportOfficersModal
          existingOfficers={officers}
          onClose={() => setShowImport(false)}
          onImported={loadOfficers}
        />
      )}
    </div>
  )
}
