import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { getIsViewer } from '../lib/roles'
import { PHASES, POSTING_CATEGORIES } from '../lib/equipmentLogic'
import Header from '../components/Header'

export default function EquipmentSettings() {
  const [catalog, setCatalog] = useState([])
  const [rules, setRules] = useState([])
  const [officerTypes, setOfficerTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [isViewer, setIsViewer] = useState(false)
  const [tab, setTab] = useState('catalog')

  const [newItem, setNewItem] = useState({ name: '', default_make: '' })
  const [savingItem, setSavingItem] = useState(false)

  const [newRule, setNewRule] = useState({})

  useEffect(() => {
    load()
    getIsViewer().then(setIsViewer)
  }, [])

  async function load() {
    setLoading(true)
    const [{ data: cat }, { data: rul }, { data: types }] = await Promise.all([
      supabase.from('equipment_catalog').select('*').order('sort_order'),
      supabase.from('equipment_rules').select('*'),
      supabase.from('officer_types').select('*').order('type_name'),
    ])
    setCatalog(cat || [])
    setRules(rul || [])
    setOfficerTypes(types || [])
    setLoading(false)
  }

  const catalogById = useMemo(() => {
    const m = {}
    catalog.forEach((c) => (m[c.id] = c))
    return m
  }, [catalog])

  async function addCatalogItem() {
    const name = newItem.name.trim()
    if (!name) return
    setSavingItem(true)
    const sort_order = catalog.reduce((max, c) => Math.max(max, c.sort_order || 0), 0) + 10
    const { error } = await supabase
      .from('equipment_catalog')
      .insert({ name, default_make: newItem.default_make.trim() || null, sort_order })
    setSavingItem(false)
    if (error) {
      alert('Could not add equipment item: ' + error.message)
      return
    }
    setNewItem({ name: '', default_make: '' })
    load()
  }

  async function updateCatalogItem(id, patch) {
    setCatalog((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    await supabase.from('equipment_catalog').update(patch).eq('id', id)
  }

  async function toggleActive(item) {
    await updateCatalogItem(item.id, { active: !item.active })
  }

  async function deleteCatalogItem(item) {
    if (
      !confirm(
        `Delete "${item.name}" from the equipment catalog?\n\n` +
          'If it is used in any equipment rules or on any event\'s sign-out sheet, deleting it ' +
          'will fail — deactivate it instead using the checkbox.'
      )
    )
      return
    const { error } = await supabase.from('equipment_catalog').delete().eq('id', item.id)
    if (error) {
      alert(
        'Could not delete — this item is still in use (a rule or an event sign-out sheet references it). ' +
          'Untick "Active" instead to retire it without breaking existing data.'
      )
      return
    }
    load()
  }

  async function addRule(phase, posting_category) {
    const key = `${phase}:${posting_category}`
    const form = newRule[key]
    if (!form?.equipment_item_id) return
    const { error } = await supabase.from('equipment_rules').insert({
      phase,
      posting_category,
      equipment_item_id: form.equipment_item_id,
      qty_per_officer: Math.max(0, Number(form.qty_per_officer) || 1),
      officer_type_name: form.officer_type_name || null,
    })
    if (error) {
      alert('Could not add rule: ' + error.message)
      return
    }
    setNewRule((prev) => ({
      ...prev,
      [key]: { equipment_item_id: '', qty_per_officer: 1, officer_type_name: '' },
    }))
    load()
  }

  async function updateRuleQty(rule, qty) {
    const q = Math.max(0, Number(qty) || 0)
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, qty_per_officer: q } : r)))
    await supabase.from('equipment_rules').update({ qty_per_officer: q }).eq('id', rule.id)
  }

  async function updateRuleOfficerType(rule, officerTypeName) {
    const value = officerTypeName || null
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, officer_type_name: value } : r)))
    const { error } = await supabase.from('equipment_rules').update({ officer_type_name: value }).eq('id', rule.id)
    if (error) {
      alert(
        'Could not update officer type — there is probably already a rule for this exact ' +
          'phase/category/equipment/officer-type combination: ' + error.message
      )
      load()
    }
  }

  async function removeRule(rule) {
    if (!confirm('Remove this rule? Events will no longer auto-issue this item for this phase/category.'))
      return
    await supabase.from('equipment_rules').delete().eq('id', rule.id)
    setRules((prev) => prev.filter((r) => r.id !== rule.id))
  }

  if (loading) return <div className="page">Loading…</div>

  return (
    <div className="page">
      <Header title="Equipment — Catalog &amp; Rules" />
      <div className="event-meta no-print" style={{ marginBottom: 8 }}>
        <Link to="/">← Back to Events</Link>
        {isViewer && <span className="viewer-badge">View-only access</span>}
      </div>

      <nav className="top-nav" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'catalog' ? 'active' : ''}`} onClick={() => setTab('catalog')}>
          Equipment Catalog
        </button>
        <button className={`tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>
          Auto-Issue Rules
        </button>
      </nav>

      {tab === 'catalog' && (
        <>
          <p>
            Every item here is available to select when signing out equipment for an event, and
            available to pick from when building a rule below. Untick "Active" to retire an item
            without deleting its history.
          </p>
          <table className="simple-table">
            <thead>
              <tr>
                <th>Equipment Type</th>
                <th>Default Make</th>
                <th>Active</th>
                {!isViewer && <th></th>}
              </tr>
            </thead>
            <tbody>
              {catalog.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      className="print-input"
                      value={item.name}
                      disabled={isViewer}
                      onChange={(e) => updateCatalogItem(item.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="print-input"
                      value={item.default_make || ''}
                      disabled={isViewer}
                      placeholder="N/A"
                      onChange={(e) => updateCatalogItem(item.id, { default_make: e.target.value })}
                    />
                  </td>
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={item.active}
                      disabled={isViewer}
                      onChange={() => toggleActive(item)}
                    />
                  </td>
                  {!isViewer && (
                    <td>
                      <button className="btn-delete" onClick={() => deleteCatalogItem(item)}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {!isViewer && (
            <div className="inline-form" style={{ marginTop: 16 }}>
              <input
                placeholder="New equipment type (e.g. Hi-Vis Vests)"
                value={newItem.name}
                onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
              />
              <input
                placeholder="Default make (optional)"
                value={newItem.default_make}
                onChange={(e) => setNewItem({ ...newItem, default_make: e.target.value })}
              />
              <button
                className="btn-primary"
                onClick={addCatalogItem}
                disabled={!newItem.name.trim() || savingItem}
              >
                {savingItem ? 'Adding…' : '+ Add Equipment Type'}
              </button>
            </div>
          )}
        </>
      )}

      {tab === 'rules' && (
        <>
          <p>
            For each combination of event phase and posting type, these rules decide what gets
            automatically issued when Shane hits "Sync from Posting Sheet" on an event's Equipment
            page. Set an Officer Type on a rule to issue that item only to that type (e.g. a
            Marshal Bib only for Marshals) — leave it as "All officer types" for something
            everyone wears, like Pullovers. Tie a rule's Officer Type to a cleaning role (e.g.
            "Event Cleaner") to make that equipment appear only on events that actually have a
            cleaner posted. Quantities are packed once per phase at the highest single
            day/section count, not summed across every day. Edit, remove or add rules any time —
            changes apply the next time an event is synced.
          </p>
          {PHASES.map((phase) =>
            POSTING_CATEGORIES.map((cat) => {
              const key = `${phase.value}:${cat.value}`
              const combinationRules = rules.filter(
                (r) => r.phase === phase.value && r.posting_category === cat.value
              )
              const form = newRule[key] || { equipment_item_id: '', qty_per_officer: 1, officer_type_name: '' }
              return (
                <div key={key} className="equipment-rule-block">
                  <h3>
                    {phase.label} — {cat.label}
                  </h3>
                  {combinationRules.length === 0 ? (
                    <p className="equipment-rule-empty">No equipment auto-issued for this combination.</p>
                  ) : (
                    <table className="simple-table equipment-rule-table">
                      <thead>
                        <tr>
                          <th>Equipment Type</th>
                          <th>Officer Type</th>
                          <th>Qty per Officer</th>
                          {!isViewer && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {combinationRules.map((rule) => (
                          <tr key={rule.id}>
                            <td>{catalogById[rule.equipment_item_id]?.name || '(deleted item)'}</td>
                            <td>
                              <select
                                className="print-input"
                                value={rule.officer_type_name || ''}
                                disabled={isViewer}
                                onChange={(e) => updateRuleOfficerType(rule, e.target.value)}
                              >
                                <option value="">All officer types</option>
                                {officerTypes.map((t) => (
                                  <option key={t.id} value={t.type_name}>
                                    {t.type_name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                className="print-input"
                                style={{ maxWidth: 80 }}
                                value={rule.qty_per_officer}
                                disabled={isViewer}
                                onChange={(e) => updateRuleQty(rule, e.target.value)}
                              />
                            </td>
                            {!isViewer && (
                              <td>
                                <button className="btn-delete" onClick={() => removeRule(rule)}>
                                  Remove
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {!isViewer && (
                    <div className="inline-form">
                      <select
                        value={form.equipment_item_id}
                        onChange={(e) =>
                          setNewRule((prev) => ({
                            ...prev,
                            [key]: { ...form, equipment_item_id: e.target.value },
                          }))
                        }
                      >
                        <option value="">— Add equipment to this rule —</option>
                        {catalog
                          .filter((c) => c.active)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                      <select
                        value={form.officer_type_name || ''}
                        onChange={(e) =>
                          setNewRule((prev) => ({
                            ...prev,
                            [key]: { ...form, officer_type_name: e.target.value },
                          }))
                        }
                      >
                        <option value="">All officer types</option>
                        {officerTypes.map((t) => (
                          <option key={t.id} value={t.type_name}>
                            {t.type_name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        style={{ maxWidth: 80 }}
                        placeholder="Qty"
                        value={form.qty_per_officer}
                        onChange={(e) =>
                          setNewRule((prev) => ({
                            ...prev,
                            [key]: { ...form, qty_per_officer: e.target.value },
                          }))
                        }
                      />
                      <button
                        className="btn-primary"
                        disabled={!form.equipment_item_id}
                        onClick={() => addRule(phase.value, cat.value)}
                      >
                        + Add Rule
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </>
      )}
    </div>
  )
}
