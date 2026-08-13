import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { getIsViewer } from '../lib/roles'
import Header from '../components/Header'

const emptyOfficer = {
  first_name: '',
  last_name: '',
  id_number: '',
  psira_number: '',
  psira_grade: '',
  bib_serial: '',
  phone: '',
}

export default function OfficerRoster() {
  const [officers, setOfficers] = useState([])
  const [types, setTypes] = useState([])
  const [form, setForm] = useState(emptyOfficer)
  const [tab, setTab] = useState('officers')
  const [isViewer, setIsViewer] = useState(false)

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
    setTypes(data || [])
  }

  async function addOfficer(e) {
    e.preventDefault()
    if (!form.first_name || !form.last_name) return
    await supabase.from('officers').insert(form)
    setForm(emptyOfficer)
    loadOfficers()
  }

  async function removeOfficer(id) {
    if (!confirm('Remove this officer from the roster?')) return
    await supabase.from('officers').delete().eq('id', id)
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
          {!isViewer && (
            <form onSubmit={addOfficer} className="inline-form">
              <input
                placeholder="First Name"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              />
              <input
                placeholder="Last Name"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
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
              <input
                placeholder="BIB / Card Serial"
                value={form.bib_serial}
                onChange={(e) => setForm({ ...form, bib_serial: e.target.value })}
              />
              <button type="submit" className="btn-primary">
                Add Officer
              </button>
            </form>
          )}

          <table className="simple-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID Number</th>
                <th>PSIRA No.</th>
                <th>Grade</th>
                <th>BIB Serial</th>
                {!isViewer && <th></th>}
              </tr>
            </thead>
            <tbody>
              {officers.map((o) => (
                <tr key={o.id}>
                  <td>
                    {o.first_name} {o.last_name}
                  </td>
                  <td>{o.id_number}</td>
                  <td>{o.psira_number}</td>
                  <td>{o.psira_grade}</td>
                  <td>{o.bib_serial}</td>
                  {!isViewer && (
                    <td>
                      <button onClick={() => removeOfficer(o.id)}>Remove</button>
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
    </div>
  )
}
