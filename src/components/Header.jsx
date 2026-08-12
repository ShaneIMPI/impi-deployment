import { Link } from 'react-router-dom'

export default function Header({ title }) {
  return (
    <header className="app-header print-header">
      <img
        src={`${import.meta.env.BASE_URL}logo.svg`}
        alt="IMPI"
        className="app-header-logo"
        onError={(e) => {
          e.target.style.display = 'none'
        }}
      />
      <div className="app-header-text">
        <div className="app-header-company">
          IMPI RMS (Pty) Ltd &nbsp;|&nbsp; t/a Amandla Protection Services
        </div>
        {title && <h1 className="app-header-title">{title}</h1>}
      </div>
      <Link to="/" className="app-header-home no-print">
        ← Home
      </Link>
    </header>
  )
}
