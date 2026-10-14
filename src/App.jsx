import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AuthGate from './components/AuthGate'
import Dashboard from './pages/Dashboard'
import EventUpload from './pages/EventUpload'
import OfficerRoster from './pages/OfficerRoster'
import PostingSheet from './pages/PostingSheet'
import PayRun from './pages/PayRun'
import EquipmentSignOut from './pages/EquipmentSignOut'
import EquipmentSettings from './pages/EquipmentSettings'

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthGate>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new-event" element={<EventUpload />} />
          <Route path="/officers" element={<OfficerRoster />} />
          <Route path="/events/:eventId/posting-sheet" element={<PostingSheet />} />
          <Route path="/events/:eventId/pay-run" element={<PayRun />} />
          <Route path="/events/:eventId/equipment" element={<EquipmentSignOut />} />
          <Route path="/equipment-settings" element={<EquipmentSettings />} />
        </Routes>
      </AuthGate>
    </BrowserRouter>
  )
}
