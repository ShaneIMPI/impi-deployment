import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import Header from '../components/Header'

export default function Dashboard() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })
    setEvents(data || [])
    setLoading(false)
  }

  async function deleteEvent(ev) {
    const ok = window.confirm(
      `Delete "${ev.event_name}"?\n\nThis permanently removes its Posting Sheet and Pay Run data. This cannot be undone.`
    )
    if (!ok) return
    await supabase.from('events').delete().eq('id', ev.id)
    setEvents((prev) => prev.filter((e) => e.id !== ev.id))
  }

  return (
    <div className="page">
      <Header title="Events" />
      <nav className="top-nav">
        <Link to="/new-event" className="btn-primary">
          + New Event (Upload Quotation)
        </Link>
        <Link to="/officers">Officer Roster</Link>
      </nav>

      {loading ? (
        <p>Loading…</p>
      ) : events.length === 0 ? (
        <p>No events yet. Upload a quotation to get started.</p>
      ) : (
        <table className="simple-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Venue</th>
              <th>Date</th>
              <th>Status</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id}>
                <td>{ev.event_name}</td>
                <td>{ev.venue}</td>
                <td>{ev.event_date}</td>
                <td>{ev.status}</td>
                <td className="row-actions">
                  <Link to={`/events/${ev.id}/posting-sheet`}>Posting Sheet</Link>
                  <Link to={`/events/${ev.id}/pay-run`}>Pay Run</Link>
                </td>
                <td>
                  <button className="btn-delete" onClick={() => deleteEvent(ev)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
