import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { getIsViewer } from '../lib/roles'
import Header from '../components/Header'
import ImportOfficersModal from '../components/ImportOfficersModal'

const emptyOfficer = {
  full_name: '',
  id_number: '',
  psira_number: '',
  phone_number: '',
  special_events: false,
  active: true,
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

  useEffect(() => {
    loadOfficers()
    loadTypes()
    getIsViewer().then(setIsViewer)
  }, [])

  async function loadOfficers() {
    const { data } = await supabase
      .from('officers')
      .select('*')
      .order('full_name', { ascending: true })
    setOfficers(data || [])
  }

  async function loadTypes() {
    const { data } = await supabase
      .from('officer_types')
      .select('*')
      .order('type_name', { ascending: true })
    setTypes(data || [])
  }

  function startEdit(o) {
    setEditingId(o.id)
    setForm({
      full_name: o.full_name || '',
      id_number: o.id_number || '',
      psira_number: o.psira_number || '',
      phone_number: o.phone_number || '',
      special_events: !!o.special_events,
      active: o.active !== false,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyOfficer)
  }

  async function saveOfficer(e) {
    e.preventDefault()
    if (!form.full_name) return
    setSaveError('')
    const { error } = editingId
      ? await supabase.from('officers').update(form).eq('id', editingId)
      : await supabase.from('officers').insert(form)
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
        sell_price: Number(t.sell_price) || 0,
        pay_rate: Number(t.pay_rate) || 0,
      })
      .eq('id', t.id)
  }

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
                placeholder="Full Name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
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
                placeholder="Phone Number"
                value={form.phone_number}
                onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
              />
              <label className="section-break-toggle">
                <input
                  type="checkbox"
                  checked={form.special_events}
                  onChange={(e) => setForm({ ...form, special_events: e.target.checked })}
                />
                Special Events
              </label>
              <label className="section-break-toggle">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                Active
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
                <th>Phone</th>
                <th>Special Events</th>
                <th>Active</th>
                {!isViewer && <th></th>}
              </tr>
            </thead>
            <tbody>
              {officers.map((o) => (
                <tr key={o.id} className={editingId === o.id ? 'warning-cell' : ''}>
                  <td>{o.full_name}</td>
                  <td>{o.id_number}</td>
                  <td>{o.psira_number}</td>
                  <td>{o.phone_number}</td>
                  <td>{o.special_events ? 'Yes' : 'No'}</td>
                  <td>{o.active !== false ? 'Yes' : 'No'}</td>
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
            Sheet, Special Events check, and Pay Run all pull from here.
          </p>
          <table className="simple-table">
            <thead>
              <tr>
                <th>Officer Type</th>
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
                    <td>
                      <button onClick={() => saveType(t)}>Save</button>
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
